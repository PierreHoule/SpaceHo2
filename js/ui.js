// Rendering and input: an animated canvas star map plus DOM side panels.
// The map draws in galaxy coordinates (DATA.GALAXY.width x .height) and is
// letterboxed into whatever size the window gives it, at device resolution.
'use strict';

// Inline ship silhouettes (26x18 viewBox) used in the sidebar. Kept as data so
// the single-file build stays self-contained — no image requests.
const SHIP_ICONS = {
  scout: 'M1 9 L18 4 L25 9 L18 14 Z',
  fighter: 'M1 9 L9 3 L13 6 L25 9 L13 12 L9 15 Z',
  destroyer: 'M1 6 L16 6 L25 9 L16 12 L1 12 L4 9 Z',
  dreadnought: 'M1 4 L14 4 L20 7 L25 9 L20 11 L14 14 L1 14 L4 9 Z',
  satellite: 'M9 9 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M1 7 L7 7 L7 11 L1 11 Z M19 7 L25 7 L25 11 L19 11 Z',
  colony: 'M2 9 Q2 4 9 4 L18 4 Q25 4 25 9 Q25 14 18 14 L9 14 Q2 14 2 9 Z',
};

// Temperature palette: frozen -> temperate -> arid -> molten.
const TEMP_STOPS = [
  { t: 0,   hi: [226, 242, 255], lo: [ 92, 134, 186] },
  { t: 28,  hi: [150, 214, 236], lo: [ 40,  96, 148] },
  { t: 48,  hi: [140, 224, 168], lo: [ 32, 106,  92] },
  { t: 68,  hi: [226, 186, 118], lo: [124,  78,  40] },
  { t: 86,  hi: [255, 150,  80], lo: [128,  44,  22] },
  { t: 100, hi: [255, 226, 150], lo: [150,  32,  16] },
];

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
function rgba(c, a) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }

function tempColors(temp) {
  const t = clamp(temp, 0, 100);
  let i = 0;
  while (i < TEMP_STOPS.length - 2 && TEMP_STOPS[i + 1].t < t) i++;
  const a = TEMP_STOPS[i];
  const b = TEMP_STOPS[i + 1];
  const f = clamp((t - a.t) / (b.t - a.t), 0, 1);
  return {
    hi: a.hi.map((v, k) => lerp(v, b.hi[k], f)),
    lo: a.lo.map((v, k) => lerp(v, b.lo[k], f)),
  };
}

const UI = {
  game: null,
  canvas: null,
  ctx: null,
  selectedStar: null,
  selectedShips: new Set(),
  sendMode: false,
  hoverStar: null,

  dpr: 1,
  view: { scale: 1, ox: 0, oy: 0, w: 0, h: 0 },
  time: 0,
  particles: [],
  waves: [],
  shipPos: new Map(),   // ship id -> {x, y, trail: [{x,y}]}
  animated: false,

  init(game) {
    this.game = game;
    this.canvas = document.getElementById('map');
    this.ctx = this.canvas.getContext('2d');

    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.draw(); });

    this.canvas.addEventListener('click', (e) => this.onMapClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMapMove(e));
    this.canvas.addEventListener('mouseleave', () => { this.hoverStar = null; this.draw(); });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.sendMode) { this.sendMode = false; this.refresh(); }
    });
    document.getElementById('ho-button').addEventListener('click', () => this.endTurn());
    document.getElementById('new-game').addEventListener('click', () => location.reload());
    document.addEventListener('keydown', (e) => this.onKey(e));

    this.buildTechPanel();
    this.syncShipPositions(true);
    this.selectStar(game.stars[game.players[0].homeId]);
    this.refresh();

    // Animate only where a frame clock exists (not in headless tests).
    if (typeof requestAnimationFrame === 'function') {
      this.animated = true;
      requestAnimationFrame((ts) => this.frame(ts));
    }
  },

  me() { return this.game.players[0]; },

  // ---------- viewport ----------

  resize() {
    const G = DATA.GALAXY;
    const wrap = this.canvas.parentElement;
    const w = (wrap && wrap.clientWidth) || G.width;
    const h = (wrap && wrap.clientHeight) || G.height;
    this.dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    const scale = Math.min(w / G.width, h / G.height) || 1;
    this.view = { scale, ox: (w - G.width * scale) / 2, oy: (h - G.height * scale) / 2, w, h };
    this._bgStars = null;   // regenerate for the new size
  },

  // Screen space (CSS px) for backgrounds and overlays.
  screenSpace(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); },

  // Galaxy space for stars, ships and effects.
  worldSpace(ctx) {
    const v = this.view;
    ctx.setTransform(this.dpr * v.scale, 0, 0, this.dpr * v.scale, this.dpr * v.ox, this.dpr * v.oy);
  },

  // ---------- events ----------

  mapPos(e) {
    const r = this.canvas.getBoundingClientRect();
    const v = this.view;
    return {
      x: (e.clientX - r.left - v.ox) / v.scale,
      y: (e.clientY - r.top - v.oy) / v.scale,
    };
  },

  starAt(pos) {
    let best = null;
    let bestD = 20;
    for (const s of this.game.stars) {
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  },

  onMapClick(e) {
    const star = this.starAt(this.mapPos(e));
    if (!star) {
      if (!this.sendMode) { this.selectedStar = null; this.refresh(); }
      return;
    }
    if (this.sendMode && this.selectedShips.size) {
      const err = this.game.sendShips([...this.selectedShips], star.id);
      if (err) {
        this.flash(err, true);
      } else {
        this.sendMode = false;
        this.selectedShips.clear();
        this.flash(`Fleet dispatched to ${star.name}.`);
        this.wave(star.x, star.y, this.me().color, 26);
      }
      this.refresh();
      return;
    }
    this.selectStar(star);
    this.refresh();
  },

  onMapMove(e) {
    const star = this.starAt(this.mapPos(e));
    if (star !== this.hoverStar) {
      this.hoverStar = star;
      if (!this.animated) this.draw();
    }
  },

  onKey(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && this.sendMode) { this.sendMode = false; this.refresh(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.endTurn(); }
  },

  selectStar(star) {
    this.selectedStar = star;
    this.sendMode = false;
    this.selectedShips.clear();
  },

  endTurn() {
    const g = this.game;
    if (g.winner || !this.me().alive) return;
    this.sendMode = false;
    this.selectedShips.clear();
    for (const p of g.players) {
      if (p.alive && p.isAI) aiTakeTurn(g, p);
    }
    g.endTurn();
    if (this.selectedStar) this.selectedStar = g.stars[this.selectedStar.id];
    this.stageEffects();
    this.syncShipPositions(false);
    this.refresh();
  },

  // Turn the turn's events into fireworks on the map.
  stageEffects() {
    for (const ev of this.game.events || []) {
      const s = this.game.stars[ev.starId];
      if (!s) continue;
      const seen = this.me().known[s.id];
      if (!seen) continue;   // don't reveal action in unexplored space
      if (ev.type === 'battle') {
        this.wave(s.x, s.y, '#ffd08a', 46);
        this.burst(s.x, s.y, ['#ffe6a8', '#ff9b52', '#ff5b5b'], 16 + Math.min(24, ev.losses * 6));
      } else if (ev.type === 'bombard') {
        this.burst(s.x, s.y, ['#ff8a5b', '#ff4d4d'], 14);
      } else if (ev.type === 'colony') {
        const col = this.game.players[ev.owner].color;
        this.wave(s.x, s.y, col, 34);
        this.burst(s.x, s.y, [col, '#ffffff'], 14);
      }
    }
  },

  flash(msg, warn) {
    const el = document.getElementById('flash');
    el.textContent = msg;
    el.classList.toggle('warn', !!warn);
    el.classList.add('show');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => el.classList.remove('show'), 2600);
  },

  // ---------- particles ----------

  burst(x, y, colors, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 14 + Math.random() * 70;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.5 + Math.random() * 0.9,
        size: 1 + Math.random() * 2.4,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  },

  wave(x, y, color, maxR) {
    this.waves.push({ x, y, color, r: 3, maxR, life: 0, max: 0.85 });
  },

  stepEffects(dt) {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const w of this.waves) {
      w.life += dt;
      w.r = 3 + (w.maxR - 3) * (w.life / w.max);
    }
    this.waves = this.waves.filter((w) => w.life < w.max);
  },

  // ---------- ship position animation ----------

  shipTarget(sh) {
    const g = this.game;
    if (sh.move) {
      const a = g.stars[sh.move.from];
      const b = g.stars[sh.move.to];
      const t = clamp(sh.move.traveled / sh.move.total, 0, 1);
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    }
    const s = g.stars[sh.at];
    return s ? { x: s.x, y: s.y } : null;
  },

  // snap=true places ships instantly (startup); otherwise they glide.
  syncShipPositions(snap) {
    const live = new Set();
    for (const sh of this.game.ships) {
      live.add(sh.id);
      const target = this.shipTarget(sh);
      if (!target) continue;
      const cur = this.shipPos.get(sh.id);
      if (!cur || snap) {
        this.shipPos.set(sh.id, { x: target.x, y: target.y, trail: [] });
      }
    }
    for (const id of [...this.shipPos.keys()]) {
      if (!live.has(id)) this.shipPos.delete(id);
    }
  },

  stepShips(dt) {
    const k = 1 - Math.pow(0.0016, dt);   // frame-rate independent easing
    for (const sh of this.game.ships) {
      const target = this.shipTarget(sh);
      if (!target) continue;
      let cur = this.shipPos.get(sh.id);
      if (!cur) {
        cur = { x: target.x, y: target.y, trail: [] };
        this.shipPos.set(sh.id, cur);
      }
      const dx = target.x - cur.x;
      const dy = target.y - cur.y;
      cur.moving = Math.hypot(dx, dy) > 0.6;
      cur.angle = cur.moving ? Math.atan2(dy, dx) : (cur.angle || 0);
      cur.x += dx * k;
      cur.y += dy * k;
      if (cur.moving) {
        cur.trail.push({ x: cur.x, y: cur.y });
        if (cur.trail.length > 14) cur.trail.shift();
      } else if (cur.trail.length) {
        cur.trail.shift();
      }
    }
  },

  frame(ts) {
    const last = this._lastTs || ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    this._lastTs = ts;
    this.time += dt;
    this.stepEffects(dt);
    this.stepShips(dt);
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  },

  // ---------- top-level refresh ----------

  refresh() {
    this.renderStatus();
    this.renderTechPanel();
    this.renderPlanetPanel();
    this.renderEmpires();
    this.renderMessages();
    this.renderGameOver();
    this.draw();
  },

  renderStatus() {
    const g = this.game;
    const me = this.me();
    document.getElementById('status').innerHTML =
      `<span class="stat">Turn <b>${g.turn}</b></span>` +
      `<span class="stat money">$<b>${me.money.toFixed(0)}</b> ` +
      `<small>+${g.playerIncome(me).toFixed(0)}</small></span>` +
      `<span class="stat metal">Metal <b>${me.metal.toFixed(0)}</b></span>` +
      `<span class="stat">Worlds <b>${g.stars.filter((s) => s.owner === 0).length}</b></span>` +
      `<span class="stat">Fleet <b>${g.ships.filter((s) => s.owner === 0).length}</b></span>`;
  },

  renderEmpires() {
    const g = this.game;
    const el = document.getElementById('empires');
    if (!el) return;
    const rows = g.players.map((p) => {
      const worlds = g.stars.filter((s) => s.owner === p.id).length;
      // You always see your own strength; rivals only where you have eyes.
      const ships = g.ships.filter((sh) => sh.owner === p.id).length;
      const known = p.id === 0
        ? `${worlds} worlds · ${ships} ships`
        : `${g.stars.filter((s) => {
            const k = g.players[0].known[s.id];
            return k && k.owner === p.id;
          }).length} known worlds`;
      return `<div class="empire ${p.alive ? '' : 'dead'}">
        <span class="dot" style="background:${p.color};color:${p.color}"></span>
        <span class="who" style="color:${p.color}">${p.name}</span>
        <b>${p.alive ? known : 'eliminated'}</b>
      </div>`;
    }).join('');
    el.innerHTML = '<h2>Empires</h2>' + rows;
  },

  renderMessages() {
    const el = document.getElementById('messages');
    const cls = (m) => /Battle|bombard|wiped|eliminated/i.test(m) ? 'battle'
      : /research reached/i.test(m) ? 'tech'
      : /Colony established|completed/i.test(m) ? 'good' : '';
    el.innerHTML = this.game.messages.length
      ? this.game.messages.map((m) => `<div class="msg ${cls(m)}">${m}</div>`).join('')
      : '<div class="msg dim">No reports this turn.</div>';
  },

  renderGameOver() {
    const overlay = document.getElementById('gameover');
    const g = this.game;
    const h1 = overlay.querySelector('h1');
    const sub = overlay.querySelector('p');
    const show = (title, text, color) => {
      overlay.classList.add('show');
      overlay.style.display = 'flex';
      h1.textContent = title;
      h1.style.color = color;
      if (sub) sub.textContent = text;
    };
    if (g.winner) {
      if (g.winner.id === 0) {
        show('🤠 Victory, Space Cowboy!', `The galaxy is yours after ${g.turn} turns.`, '#f2c14e');
      } else {
        show(`Defeat — ${g.winner.name} rules the galaxy`,
          `Your empire fell after ${g.turn} turns.`, '#ff6b6b');
      }
    } else if (!this.me().alive) {
      show('Your empire has fallen.', `Eliminated on turn ${g.turn}.`, '#ff6b6b');
    } else {
      overlay.classList.remove('show');
      overlay.style.display = 'none';
    }
  },

  // ---------- tech panel ----------

  buildTechPanel() {
    const el = document.getElementById('tech');
    el.innerHTML = '<h2>Research</h2>' + DATA.TECH_KEYS.map((key) => `
      <div class="tech-row" title="${DATA.TECH[key].desc}">
        <span class="tech-name">${DATA.TECH[key].name}</span>
        <span class="tech-level" id="tech-level-${key}">1</span>
        <div class="bar"><div class="bar-fill" id="tech-bar-${key}"></div></div>
        <input type="range" min="0" max="60" step="5" value="0" id="tech-slider-${key}">
        <span class="tech-spend" id="tech-spend-${key}">$0</span>
      </div>`).join('');
    for (const key of DATA.TECH_KEYS) {
      document.getElementById(`tech-slider-${key}`).addEventListener('input', (e) => {
        this.me().techFunding[key] = Number(e.target.value);
        this.renderTechPanel();
      });
    }
  },

  renderTechPanel() {
    const me = this.me();
    for (const key of DATA.TECH_KEYS) {
      document.getElementById(`tech-level-${key}`).textContent = me.tech[key];
      const cost = this.game.techLevelCost(me, key);
      const pct = Math.min(100, (me.techProgress[key] / cost) * 100);
      document.getElementById(`tech-bar-${key}`).style.width = pct + '%';
      document.getElementById(`tech-slider-${key}`).value = me.techFunding[key];
      document.getElementById(`tech-spend-${key}`).textContent =
        '$' + me.techFunding[key].toFixed(0);
    }
  },

  // ---------- planet panel ----------

  shipIcon(key) {
    return `<svg viewBox="0 0 26 18" aria-hidden="true"><path fill="currentColor" d="${SHIP_ICONS[key]}"/></svg>`;
  },

  renderPlanetPanel() {
    const el = document.getElementById('planet');
    const g = this.game;
    const me = this.me();
    const star = this.selectedStar;
    if (!star) {
      el.innerHTML = '<h2>Planet</h2><p class="dim">Click a star on the map.</p>';
      return;
    }
    const known = me.known[star.id];
    const ownedByMe = star.owner === 0;
    const live = ownedByMe || this.visibleToMe(star);

    if (!known) {
      el.innerHTML = `<h2>Planet</h2>
        <div class="planet-head">
          <canvas id="planet-portrait" width="136" height="136"></canvas>
          <div class="planet-title"><div class="name">${star.name}</div>
          <div class="sub">Unsurveyed</div></div>
        </div>
        <p class="dim">Unexplored. Send a scout to survey it.</p>`;
      this.drawPortrait(null);
      return;
    }

    const info = live ? star : known;
    const suit = g.suitability(me, { temp: info.temp, gravity: info.gravity });
    const ownerName = info.owner < 0 ? 'Uninhabited'
      : info.owner === 0 ? 'Your colony' : g.players[info.owner].name;
    const ownerColor = info.owner >= 0 ? g.players[info.owner].color : '#8a90a8';

    let html = `<h2>Planet</h2>
      <div class="planet-head">
        <canvas id="planet-portrait" width="136" height="136"></canvas>
        <div class="planet-title">
          <div class="name">${star.name}</div>
          <div class="sub" style="color:${ownerColor}">${ownerName}</div>
        </div>
      </div>
      <div class="kv"><span>Population</span><b>${info.pop.toFixed(0)}M</b></div>
      <div class="kv"><span>Temperature</span><b>${info.temp.toFixed(0)}° <small>ideal ${me.idealTemp}°</small></b></div>
      <div class="kv"><span>Gravity</span><b>${info.gravity.toFixed(1)}g <small>ideal ${me.idealGravity}g</small></b></div>
      <div class="kv"><span>Metal reserves</span><b>${info.metal.toFixed(0)}</b></div>
      <div class="kv"><span>Suitability</span><b>${(suit * 100).toFixed(0)}%</b></div>
      <div class="gauge"><i style="width:${(suit * 100).toFixed(0)}%"></i></div>`;
    if (!live) html += `<p class="dim">Last surveyed turn ${known.turn}.</p>`;

    if (ownedByMe) {
      html += `
        <div class="kv"><span>Income</span><b>$${g.planetIncome(me, star).toFixed(0)}/turn</b></div>
        <div class="slider-row">
          <label><span>Terraform</span><b>$${star.terraformBudget}/turn</b></label>
          <input type="range" id="terraform-slider" min="0" max="100" step="5" value="${star.terraformBudget}">
        </div>
        <div class="slider-row">
          <label><span>Mining</span><b>$${star.miningBudget}/turn</b></label>
          <input type="range" id="mining-slider" min="0" max="100" step="5" value="${star.miningBudget}">
        </div>
        <h3>Shipyard</h3>
        <div class="build-buttons">` +
        DATA.SHIP_KEYS.map((key) => {
          const c = g.shipCost(me, key);
          return `<button class="build" data-type="${key}"
            title="${this.shipTooltip(key)}">${this.shipIcon(key)}${DATA.SHIPS[key].name}
            <small>$${c.money} · ${c.metal}m</small></button>`;
        }).join('') + '</div>';
      if (star.queue.length) {
        html += '<div class="queue">Building: ' + star.queue.map((t, i) =>
          `<span class="queue-item" data-i="${i}" title="Click to cancel">${DATA.SHIPS[t].name} ✕</span>`
        ).join('') + '</div>';
      }
    }

    html += this.fleetHtml(star);
    el.innerHTML = html;
    this.drawPortrait(live || known ? info : null);
    this.bindPlanetPanel(star);
  },

  // Small lit sphere beside the planet name.
  drawPortrait(info) {
    const c = document.getElementById('planet-portrait');
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 136, 136);
    const star = this.selectedStar;
    this.drawPlanetBody(ctx, 68, 68, info ? 52 : 30, info, this.time, star ? star.id : 0);
  },

  shipTooltip(key) {
    const s = this.game.shipStats(this.me(), key);
    const d = DATA.SHIPS[key];
    if (!d.mobile) return `Immobile defense. Attack ${s.atk}, HP ${s.hp}`;
    if (d.colony) return `Settles uninhabited planets. Range ${s.rng.toFixed(0)}`;
    return `Attack ${s.atk}, HP ${s.hp}, Speed ${s.spd.toFixed(0)}, Range ${s.rng.toFixed(0)}`;
  },

  fleetHtml(star) {
    const mine = this.game.shipsAt(star.id, 0);
    const theirs = this.game.ships.filter((sh) => sh.at === star.id && sh.owner !== 0);
    let html = '';
    if (mine.length) {
      html += '<h3>Your ships here</h3><div class="fleet">' + mine.map((sh) => {
        const mobile = DATA.SHIPS[sh.type].mobile;
        const pct = Math.max(0, Math.min(100, (sh.hp / sh.maxHp) * 100));
        const hpCls = pct > 66 ? '' : pct > 33 ? 'hurt' : 'crit';
        return `<label class="ship ${mobile ? '' : 'immobile'}">
          <input type="checkbox" data-ship="${sh.id}"
            ${this.selectedShips.has(sh.id) ? 'checked' : ''}
            ${mobile ? '' : 'disabled'}>
          ${this.shipIcon(sh.type)}
          <span>${DATA.SHIPS[sh.type].name}</span>
          <small>atk ${sh.atk}</small>
          <span class="hpbar" title="${sh.hp}/${sh.maxHp} HP"><i class="${hpCls}" style="width:${pct}%"></i></span>
        </label>`;
      }).join('') + '</div>';
      const mobile = mine.filter((sh) => DATA.SHIPS[sh.type].mobile);
      if (mobile.length) {
        html += `<div class="fleet-actions">
          <button id="select-all">All</button>
          <button id="send-ships" class="${this.sendMode ? 'active' : ''}">
            ${this.sendMode ? 'Click a destination…' : 'Send selected ▸'}</button>
        </div>`;
      }
    }
    if (theirs.length && this.visibleToMe(star)) {
      const byOwner = {};
      for (const sh of theirs) byOwner[sh.owner] = (byOwner[sh.owner] || 0) + 1;
      html += '<h3>Other fleets</h3>' + Object.entries(byOwner).map(([o, n]) =>
        `<div class="kv"><span style="color:${this.game.players[o].color}">${this.game.players[o].name}</span><b>${n} ship(s)</b></div>`
      ).join('');
    }
    return html;
  },

  visibleToMe(star) {
    return star.owner === 0 || this.game.ships.some((sh) => sh.owner === 0 && sh.at === star.id);
  },

  bindPlanetPanel(star) {
    const g = this.game;
    const terraform = document.getElementById('terraform-slider');
    if (terraform) terraform.addEventListener('input', (e) => {
      star.terraformBudget = Number(e.target.value);
      e.target.previousElementSibling.innerHTML =
        `<span>Terraform</span><b>$${star.terraformBudget}/turn</b>`;
    });
    const mining = document.getElementById('mining-slider');
    if (mining) mining.addEventListener('input', (e) => {
      star.miningBudget = Number(e.target.value);
      e.target.previousElementSibling.innerHTML =
        `<span>Mining</span><b>$${star.miningBudget}/turn</b>`;
    });
    for (const btn of document.querySelectorAll('button.build')) {
      btn.addEventListener('click', () => {
        const err = g.buildShip(this.me(), star.id, btn.dataset.type);
        if (err) this.flash(err, true);
        this.refresh();
      });
    }
    for (const q of document.querySelectorAll('.queue-item')) {
      q.addEventListener('click', () => {
        g.cancelBuild(this.me(), star.id, Number(q.dataset.i));
        this.refresh();
      });
    }
    for (const cb of document.querySelectorAll('input[data-ship]')) {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.ship);
        if (cb.checked) this.selectedShips.add(id);
        else this.selectedShips.delete(id);
        this.sendMode = false;
        if (!this.animated) this.draw();
      });
    }
    const all = document.getElementById('select-all');
    if (all) all.addEventListener('click', () => {
      for (const sh of g.shipsAt(star.id, 0)) {
        if (DATA.SHIPS[sh.type].mobile) this.selectedShips.add(sh.id);
      }
      this.refresh();
    });
    const send = document.getElementById('send-ships');
    if (send) send.addEventListener('click', () => {
      if (!this.selectedShips.size) { this.flash('Select ships first.', true); return; }
      this.sendMode = !this.sendMode;
      this.refresh();
    });
  },

  // ---------- canvas ----------

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.game;
    const me = this.me();

    this.screenSpace(ctx);
    ctx.clearRect(0, 0, this.view.w, this.view.h);
    this.drawBackdrop(ctx);

    this.worldSpace(ctx);
    this.drawRangeCircle(ctx, g);
    this.drawCourses(ctx, g);
    for (const star of g.stars) this.drawStar(ctx, star, me);
    this.drawFleets(ctx, g);
    this.drawEffects(ctx);

    this.screenSpace(ctx);
    this.drawTooltip(ctx);
  },

  // Nebula clouds + parallax starfield, cached where possible.
  drawBackdrop(ctx) {
    const { w, h } = this.view;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    if (bg && bg.addColorStop) {
      bg.addColorStop(0, '#070c1a');
      bg.addColorStop(1, '#04060d');
      ctx.fillStyle = bg;
    } else {
      ctx.fillStyle = '#05070f';
    }
    ctx.fillRect(0, 0, w, h);

    if (!this._bgStars) this.makeBackdrop(w, h);

    // Nebulae: soft coloured clouds drifting very slowly.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const n of this._nebulae) {
      const drift = Math.sin(this.time * 0.05 + n.phase) * 8;
      const gr = ctx.createRadialGradient(n.x + drift, n.y, 0, n.x + drift, n.y, n.r);
      if (gr && gr.addColorStop) {
        gr.addColorStop(0, rgba(n.color, 0.16));
        gr.addColorStop(0.5, rgba(n.color, 0.06));
        gr.addColorStop(1, rgba(n.color, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(n.x + drift, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Distant stars, twinkling at their own rates.
    for (const s of this._bgStars) {
      const tw = 0.55 + 0.45 * Math.sin(this.time * s.tw + s.phase);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  makeBackdrop(w, h) {
    const rng = makeRng(42);
    const tints = ['#ffffff', '#cfe0ff', '#ffe9c9', '#d8ccff'];
    this._bgStars = Array.from({ length: 260 }, () => ({
      x: rng() * w,
      y: rng() * h,
      r: rng() * 1.2 + 0.25,
      a: rng() * 0.55 + 0.15,
      tw: 0.6 + rng() * 2.2,
      phase: rng() * Math.PI * 2,
      color: tints[(rng() * tints.length) | 0],
    }));
    const palette = [[80, 130, 255], [190, 90, 220], [60, 190, 200], [230, 120, 90]];
    this._nebulae = Array.from({ length: 5 }, (_, i) => ({
      x: rng() * w,
      y: rng() * h,
      r: Math.max(w, h) * (0.22 + rng() * 0.28),
      color: palette[i % palette.length],
      phase: rng() * Math.PI * 2,
    }));
  },

  drawRangeCircle(ctx, g) {
    if (!this.sendMode || !this.selectedStar || !this.selectedShips.size) return;
    const ships = g.ships.filter((sh) => this.selectedShips.has(sh.id));
    if (!ships.length) return;
    const range = Math.min(...ships.map((sh) => sh.rng));
    const pulse = 0.35 + 0.15 * Math.sin(this.time * 3);
    const c = this.selectedStar;

    const gr = ctx.createRadialGradient(c.x, c.y, range * 0.55, c.x, c.y, range);
    if (gr && gr.addColorStop) {
      gr.addColorStop(0, 'rgba(86,182,255,0)');
      gr.addColorStop(1, `rgba(86,182,255,${pulse * 0.18})`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(c.x, c.y, range, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, range, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(120,205,255,${0.45 + pulse * 0.4})`;
    ctx.setLineDash([8, 7]);
    ctx.lineDashOffset = -this.time * 22;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  },

  // Dashed course lines from each of your travelling ships to its destination.
  drawCourses(ctx, g) {
    ctx.save();
    ctx.setLineDash([5, 8]);
    ctx.lineDashOffset = -this.time * 16;
    ctx.lineWidth = 1;
    for (const sh of g.ships) {
      if (!sh.move || sh.owner !== 0) continue;
      const pos = this.shipPos.get(sh.id);
      const b = g.stars[sh.move.to];
      if (!pos || !b) continue;
      ctx.strokeStyle = 'rgba(120,200,255,0.28)';
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  },

  drawFleets(ctx, g) {
    for (const sh of g.ships) {
      if (sh.owner !== 0 || !sh.move) continue;   // fog of war: only your traffic
      const pos = this.shipPos.get(sh.id);
      if (!pos) continue;
      const color = g.players[0].color;

      // engine trail
      for (let i = 0; i < pos.trail.length; i++) {
        const t = i / pos.trail.length;
        ctx.globalAlpha = t * 0.5;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.trail[i].x, pos.trail[i].y, 0.6 + t * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.drawShipMarker(ctx, pos.x, pos.y, pos.angle || 0, color, sh.type);
    }
  },

  drawStar(ctx, star, me) {
    const g = this.game;
    const known = me.known[star.id];
    const live = star.owner === 0 || g.ships.some((sh) => sh.owner === 0 && sh.at === star.id);
    const info = live ? star : known;
    const r = info ? 6 + Math.min(5, info.pop / 90) : 5;

    this.drawPlanetBody(ctx, star.x, star.y, r, known ? info : null, this.time + star.id, star.id);

    // Ownership. A hot world owned by a red empire must not read the same as
    // an unowned hot world, so the ring gets a dark backing and sits on top of
    // the glow — the flag, not the atmosphere, tells you who holds the system.
    if (info && info.owner >= 0) {
      const col = g.players[info.owner].color;

      const gr = ctx.createRadialGradient(star.x, star.y, r, star.x, star.y, r + 15);
      if (gr && gr.addColorStop) {
        gr.addColorStop(0, col + '4d');
        gr.addColorStop(1, col + '00');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(star.x, star.y, r + 15, 0, Math.PI * 2);
        ctx.fill();
      }

      const rr = r + 5.5;
      ctx.beginPath();
      ctx.arc(star.x, star.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(3,6,14,0.8)';
      ctx.lineWidth = 3.6;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(star.x, star.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.globalAlpha = live ? 1 : 0.55;
      if (!live) ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // a slowly turning orbital band for flourish
      ctx.save();
      ctx.translate(star.x, star.y);
      ctx.rotate(this.time * 0.25 + star.id);
      ctx.strokeStyle = col;
      ctx.globalAlpha = live ? 0.55 : 0.25;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, rr + 4.5, (rr + 4.5) * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // The traditional hat on your own worlds.
    if (star.owner === 0) {
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🤠', star.x, star.y - r - 9);
    }

    // Fleet pips for ships parked here.
    const present = g.ships.filter((sh) => sh.at === star.id);
    if (present.length && (live || present.some((sh) => sh.owner === 0))) {
      const owners = [...new Set(present.map((sh) => sh.owner))];
      owners.forEach((o, i) => {
        const n = present.filter((sh) => sh.owner === o).length;
        const col = g.players[o].color;
        const px = star.x + r + 7;
        const py = star.y - 2 + i * 11;
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 6;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(px, py - 3.5);
        ctx.lineTo(px + 6, py);
        ctx.lineTo(px, py + 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = col;
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(n), px + 8.5, py + 3.5);
      });
    }

    // Name label with a dark halo so it stays readable over nebulae.
    const selected = star === this.selectedStar;
    ctx.font = selected ? 'bold 11px system-ui, sans-serif' : '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(3,6,14,0.85)';
    // Round joins: mitred joins on a thick text outline throw long spikes.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(star.name, star.x, star.y + r + 16);
    ctx.fillStyle = selected ? '#ffffff' : known ? '#9aa3c0' : '#5e678f';
    ctx.fillText(star.name, star.x, star.y + r + 16);

    if (selected) this.drawReticle(ctx, star.x, star.y, r + 12);
  },

  // Lit sphere with terminator shading, rim light and atmosphere. An
  // unsurveyed system is drawn as the star itself — a twinkling point of
  // light — so the map reads at a glance: points are unknown, spheres are
  // worlds you have surveyed.
  drawPlanetBody(ctx, x, y, r, info, phase, seed) {
    if (!info) {
      const TINTS = [
        [205, 224, 255], [255, 255, 255], [255, 240, 205],
        [255, 214, 170], [255, 186, 158], [222, 232, 255],
      ];
      const c = TINTS[Math.abs(seed | 0) % TINTS.length];
      const tw = 0.7 + 0.3 * Math.sin(phase * 1.7);

      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 2.7);
      if (halo && halo.addColorStop) {
        halo.addColorStop(0, rgba(c, 0.5 * tw));
        halo.addColorStop(0.35, rgba(c, 0.12 * tw));
        halo.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // diffraction glints
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(c, 0.45 * tw);
      ctx.lineWidth = Math.max(0.5, r * 0.14);
      ctx.lineCap = 'round';
      const sp = r * 2.3 * tw;
      ctx.beginPath();
      ctx.moveTo(x - sp, y); ctx.lineTo(x + sp, y);
      ctx.moveTo(x, y - sp); ctx.lineTo(x, y + sp);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = rgba(c, 0.95);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const cols = tempColors(info.temp);
    const lx = x - r * 0.34;
    const ly = y - r * 0.34;

    // atmosphere / corona
    const halo = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.55);
    if (halo && halo.addColorStop) {
      halo.addColorStop(0, rgba(cols.hi, 0.3));
      halo.addColorStop(1, rgba(cols.hi, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // body
    const body = ctx.createRadialGradient(lx, ly, r * 0.08, x, y, r);
    if (body && body.addColorStop) {
      body.addColorStop(0, rgb(cols.hi.map((v) => Math.min(255, v * 1.12))));
      body.addColorStop(0.55, rgb(cols.lo.map((v, i) => lerp(cols.hi[i], v, 0.55))));
      body.addColorStop(1, rgb(cols.lo.map((v) => v * 0.35)));
      ctx.fillStyle = body;
    } else {
      ctx.fillStyle = rgb(cols.hi);
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // banding, so worlds read as textured rather than flat discs
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = rgb(cols.lo);
    for (let i = -2; i <= 2; i++) {
      const by = y + i * r * 0.36 + Math.sin(phase * 0.3 + i) * r * 0.05;
      ctx.beginPath();
      ctx.ellipse(x, by, r, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // polar caps on cold worlds
    if (info.temp < 40) {
      ctx.globalAlpha = clamp((40 - info.temp) / 40, 0, 1) * 0.65;
      ctx.fillStyle = '#eef6ff';
      ctx.beginPath();
      ctx.ellipse(x, y - r * 0.92, r * 0.6, r * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.92, r * 0.6, r * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // night-side city lights on populated worlds
    if (info.owner >= 0 && info.pop > 5 && r > 5) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffe9a8';
      const n = Math.min(9, 2 + Math.floor(info.pop / 40));
      for (let i = 0; i < n; i++) {
        const a = phase * 0.12 + i * 2.399;
        const rad = r * (0.35 + ((i * 0.37) % 0.5));
        const cxp = x + Math.cos(a) * rad * 0.9 + r * 0.28;
        const cyp = y + Math.sin(a) * rad * 0.9 + r * 0.28;
        if (Math.hypot(cxp - x, cyp - y) > r * 0.94) continue;
        ctx.beginPath();
        ctx.arc(cxp, cyp, Math.max(0.5, r * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // terminator shadow
    const shade = ctx.createRadialGradient(lx, ly, r * 0.2, x, y, r * 1.05);
    if (shade && shade.addColorStop) {
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(0.62, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // rim light on the lit limb
    ctx.beginPath();
    ctx.arc(x, y, r * 0.99, Math.PI * 1.05, Math.PI * 1.95);
    ctx.strokeStyle = rgba(cols.hi, 0.75);
    ctx.lineWidth = Math.max(0.6, r * 0.07);
    ctx.stroke();
  },

  drawReticle(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.time * 0.7);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r, i * Math.PI / 2 + 0.22, i * Math.PI / 2 + Math.PI / 2 - 0.22);
      ctx.stroke();
    }
    ctx.restore();
    const pulse = 1 + 0.06 * Math.sin(this.time * 4);
    ctx.beginPath();
    ctx.arc(x, y, r * pulse + 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,200,255,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
  },

  drawShipMarker(ctx, x, y, angle, color, type) {
    const big = type === 'dreadnought' || type === 'destroyer';
    const s = big ? 1.35 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // engine glow
    const gl = ctx.createRadialGradient(-5 * s, 0, 0, -5 * s, 0, 7 * s);
    if (gl && gl.addColorStop) {
      gl.addColorStop(0, 'rgba(180,230,255,0.75)');
      gl.addColorStop(1, 'rgba(180,230,255,0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(-5 * s, 0, 7 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(7 * s, 0);
    ctx.lineTo(-4 * s, 4.2 * s);
    ctx.lineTo(-1.5 * s, 0);
    ctx.lineTo(-4 * s, -4.2 * s);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  },

  drawEffects(ctx) {
    for (const w of this.waves) {
      const a = 1 - w.life / w.max;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.strokeStyle = w.color;
      ctx.globalAlpha = a * 0.7;
      ctx.lineWidth = 2 * a + 0.4;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a + 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  // Hover card, drawn in screen space so it never scales oddly.
  drawTooltip(ctx) {
    const star = this.hoverStar;
    if (!star || star === this.selectedStar) return;
    const me = this.me();
    const known = me.known[star.id];
    const live = star.owner === 0 || this.visibleToMe(star);
    const info = live ? star : known;

    const lines = [];
    if (!known) {
      lines.push(['Unsurveyed', '#8a90a8']);
    } else {
      const owner = info.owner < 0 ? 'Uninhabited'
        : info.owner === 0 ? 'Your colony' : this.game.players[info.owner].name;
      const col = info.owner >= 0 ? this.game.players[info.owner].color : '#8a90a8';
      lines.push([owner, col]);
      lines.push([`${info.temp.toFixed(0)}°  ${info.gravity.toFixed(1)}g`, '#c3cbe4']);
      lines.push([`pop ${info.pop.toFixed(0)}M   metal ${info.metal.toFixed(0)}`, '#8a90a8']);
      const suit = this.game.suitability(me, { temp: info.temp, gravity: info.gravity });
      lines.push([`suitability ${(suit * 100).toFixed(0)}%`, '#8a90a8']);
      if (!live) lines.push([`surveyed turn ${known.turn}`, '#6b7a9c']);
    }

    const v = this.view;
    const sx = star.x * v.scale + v.ox;
    const sy = star.y * v.scale + v.oy;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const measure = (t) => {
      const m = ctx.measureText ? ctx.measureText(t) : null;
      return (m && m.width) || t.length * 6.6;
    };
    const w = Math.max(96, ...lines.map((l) => measure(l[0]))) + 20;
    const h = 20 + lines.length * 16;
    let bx = sx + 30;
    let by = sy - h / 2;
    if (bx + w > v.w - 8) bx = sx - 30 - w;
    by = clamp(by, 8, Math.max(8, v.h - h - 8));

    ctx.fillStyle = 'rgba(9,13,26,0.93)';
    ctx.strokeStyle = 'rgba(120,190,255,0.45)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(bx, by, w, h);
      ctx.strokeRect(bx, by, w, h);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12.5px system-ui, sans-serif';
    ctx.fillText(star.name, bx + 10, by + 17);
    ctx.font = '12px system-ui, sans-serif';
    lines.forEach((l, i) => {
      ctx.fillStyle = l[1];
      ctx.fillText(l[0], bx + 10, by + 33 + i * 16);
    });
  },
};

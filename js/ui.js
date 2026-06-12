// Rendering and input: canvas star map plus DOM side panels.
'use strict';

const UI = {
  game: null,
  canvas: null,
  ctx: null,
  selectedStar: null,
  selectedShips: new Set(),
  sendMode: false,
  hoverStar: null,

  init(game) {
    this.game = game;
    this.canvas = document.getElementById('map');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = DATA.GALAXY.width;
    this.canvas.height = DATA.GALAXY.height;

    this.canvas.addEventListener('click', (e) => this.onMapClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMapMove(e));
    document.getElementById('ho-button').addEventListener('click', () => this.endTurn());
    document.getElementById('new-game').addEventListener('click', () => location.reload());

    this.buildTechPanel();
    this.selectStar(game.stars[game.players[0].homeId]);
    this.refresh();
  },

  me() { return this.game.players[0]; },

  // ---------- events ----------

  mapPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (this.canvas.width / r.width),
      y: (e.clientY - r.top) * (this.canvas.height / r.height),
    };
  },

  starAt(pos) {
    let best = null;
    let bestD = 18;
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
        this.flash(err);
      } else {
        this.sendMode = false;
        this.selectedShips.clear();
        this.flash(`Fleet dispatched to ${star.name}.`);
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
      this.draw();
    }
  },

  selectStar(star) {
    this.selectedStar = star;
    this.sendMode = false;
    this.selectedShips.clear();
  },

  endTurn() {
    const g = this.game;
    if (g.winner) return;
    this.sendMode = false;
    this.selectedShips.clear();
    for (const p of g.players) {
      if (p.alive && p.isAI) aiTakeTurn(g, p);
    }
    g.endTurn();
    if (this.selectedStar) this.selectedStar = g.stars[this.selectedStar.id];
    this.refresh();
  },

  flash(msg) {
    const el = document.getElementById('flash');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => el.classList.remove('show'), 2500);
  },

  // ---------- top-level refresh ----------

  refresh() {
    this.renderStatus();
    this.renderTechPanel();
    this.renderPlanetPanel();
    this.renderMessages();
    this.renderGameOver();
    this.draw();
  },

  renderStatus() {
    const g = this.game;
    const me = this.me();
    document.getElementById('status').innerHTML =
      `<span class="stat">Turn <b>${g.turn}</b></span>` +
      `<span class="stat">$<b>${me.money.toFixed(0)}</b> ` +
      `<small>(+${g.playerIncome(me).toFixed(0)}/turn)</small></span>` +
      `<span class="stat">Metal <b>${me.metal.toFixed(0)}</b></span>` +
      `<span class="stat">Planets <b>${g.stars.filter((s) => s.owner === 0).length}</b></span>` +
      `<span class="stat">Ships <b>${g.ships.filter((s) => s.owner === 0).length}</b></span>`;
  },

  renderMessages() {
    const el = document.getElementById('messages');
    el.innerHTML = this.game.messages.length
      ? this.game.messages.map((m) => `<div class="msg">${m}</div>`).join('')
      : '<div class="msg dim">No reports this turn.</div>';
  },

  renderGameOver() {
    const overlay = document.getElementById('gameover');
    const g = this.game;
    if (g.winner) {
      overlay.style.display = 'flex';
      overlay.querySelector('h1').textContent =
        g.winner.id === 0 ? '🤠 Victory, Space Cowboy!' : `Defeat — ${g.winner.name} rules the galaxy`;
    } else if (!this.me().alive) {
      overlay.style.display = 'flex';
      overlay.querySelector('h1').textContent = 'Your empire has fallen.';
    } else {
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

    let html = `<h2>${star.name}</h2>`;
    if (!known) {
      html += '<p class="dim">Unexplored. Send a scout to survey it.</p>';
      el.innerHTML = html;
      return;
    }
    const info = live ? star : known;
    const suit = g.suitability(me, { temp: info.temp, gravity: info.gravity });
    const ownerName = info.owner < 0 ? 'Uninhabited'
      : info.owner === 0 ? 'Your colony' : g.players[info.owner].name;
    html += `<div class="kv"><span>Owner</span><b style="color:${info.owner >= 0 ? g.players[info.owner].color : '#999'}">${ownerName}</b></div>
      <div class="kv"><span>Population</span><b>${info.pop.toFixed(0)}M</b></div>
      <div class="kv"><span>Temperature</span><b>${info.temp.toFixed(0)}° <small>(ideal ${me.idealTemp}°)</small></b></div>
      <div class="kv"><span>Gravity</span><b>${info.gravity.toFixed(1)}g <small>(ideal ${me.idealGravity}g)</small></b></div>
      <div class="kv"><span>Metal reserves</span><b>${info.metal.toFixed(0)}</b></div>
      <div class="kv"><span>Suitability</span><b>${(suit * 100).toFixed(0)}%</b></div>`;
    if (!live) html += `<p class="dim">Last surveyed turn ${known.turn}.</p>`;

    if (ownedByMe) {
      html += `
        <div class="kv"><span>Income</span><b>$${g.planetIncome(me, star).toFixed(0)}/turn</b></div>
        <div class="slider-row">
          <label>Terraform $${star.terraformBudget}/turn</label>
          <input type="range" id="terraform-slider" min="0" max="100" step="5" value="${star.terraformBudget}">
        </div>
        <div class="slider-row">
          <label>Mining $${star.miningBudget}/turn</label>
          <input type="range" id="mining-slider" min="0" max="100" step="5" value="${star.miningBudget}">
        </div>
        <h3>Shipyard</h3>
        <div class="build-buttons">` +
        DATA.SHIP_KEYS.map((key) => {
          const c = g.shipCost(me, key);
          return `<button class="build" data-type="${key}"
            title="${this.shipTooltip(key)}">${DATA.SHIPS[key].name}<br>
            <small>$${c.money} / ${c.metal}m</small></button>`;
        }).join('') + '</div>';
      if (star.queue.length) {
        html += '<div class="queue">Building: ' + star.queue.map((t, i) =>
          `<span class="queue-item" data-i="${i}" title="Click to cancel">${DATA.SHIPS[t].name} ✕</span>`
        ).join(' ') + '</div>';
      }
    }

    html += this.fleetHtml(star);
    el.innerHTML = html;
    this.bindPlanetPanel(star);
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
      html += '<h3>Your ships here</h3><div class="fleet">' + mine.map((sh) =>
        `<label class="ship ${DATA.SHIPS[sh.type].mobile ? '' : 'immobile'}">
          <input type="checkbox" data-ship="${sh.id}"
            ${this.selectedShips.has(sh.id) ? 'checked' : ''}
            ${DATA.SHIPS[sh.type].mobile ? '' : 'disabled'}>
          ${DATA.SHIPS[sh.type].name} <small>atk ${sh.atk} · hp ${sh.hp}/${sh.maxHp}</small>
        </label>`).join('') + '</div>';
      const mobile = mine.filter((sh) => DATA.SHIPS[sh.type].mobile);
      if (mobile.length) {
        html += `<div class="fleet-actions">
          <button id="select-all">All</button>
          <button id="send-ships" class="${this.sendMode ? 'active' : ''}">
            ${this.sendMode ? 'Click a destination star…' : 'Send selected ▸'}</button>
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
      e.target.previousElementSibling.textContent = `Terraform $${star.terraformBudget}/turn`;
    });
    const mining = document.getElementById('mining-slider');
    if (mining) mining.addEventListener('input', (e) => {
      star.miningBudget = Number(e.target.value);
      e.target.previousElementSibling.textContent = `Mining $${star.miningBudget}/turn`;
    });
    for (const btn of document.querySelectorAll('button.build')) {
      btn.addEventListener('click', () => {
        const err = g.buildShip(this.me(), star.id, btn.dataset.type);
        if (err) this.flash(err);
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
        this.draw();
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
      if (!this.selectedShips.size) { this.flash('Select ships first.'); return; }
      this.sendMode = !this.sendMode;
      this.refresh();
    });
  },

  // ---------- canvas ----------

  draw() {
    const ctx = this.ctx;
    const g = this.game;
    const me = this.me();
    ctx.fillStyle = '#06080f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawStarfield(ctx);

    // Range circle while choosing a destination.
    if (this.sendMode && this.selectedStar && this.selectedShips.size) {
      const ships = g.ships.filter((sh) => this.selectedShips.has(sh.id));
      if (ships.length) {
        const range = Math.min(...ships.map((sh) => sh.rng));
        ctx.beginPath();
        ctx.arc(this.selectedStar.x, this.selectedStar.y, range, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(120,200,255,0.5)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Ships in transit (only the player's own are drawn).
    for (const sh of g.ships) {
      if (!sh.move || sh.owner !== 0) continue;
      const a = g.stars[sh.move.from];
      const b = g.stars[sh.move.to];
      const t = sh.move.traveled / sh.move.total;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      ctx.strokeStyle = 'rgba(120,200,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      this.drawShipMarker(ctx, x, y, Math.atan2(b.y - a.y, b.x - a.x), me.color);
    }

    for (const star of g.stars) this.drawStar(ctx, star, me);

    if (this.hoverStar) {
      ctx.beginPath();
      ctx.arc(this.hoverStar.x, this.hoverStar.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  },

  drawStarfield(ctx) {
    if (!this._bgStars) {
      const rng = makeRng(42);
      this._bgStars = Array.from({ length: 180 }, () => ({
        x: rng() * this.canvas.width,
        y: rng() * this.canvas.height,
        r: rng() * 1.1 + 0.2,
        a: rng() * 0.4 + 0.1,
      }));
    }
    for (const s of this._bgStars) {
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawStar(ctx, star, me) {
    const g = this.game;
    const known = me.known[star.id];
    const live = star.owner === 0 || g.ships.some((sh) => sh.owner === 0 && sh.at === star.id);
    const info = live ? star : known;

    // Star body: hue hints at temperature once surveyed.
    const r = info ? 5 + Math.min(4, info.pop / 100) : 4;
    ctx.beginPath();
    ctx.arc(star.x, star.y, r, 0, Math.PI * 2);
    if (!known) {
      ctx.fillStyle = '#3a3f52';
    } else {
      const t = info.temp / 100;
      ctx.fillStyle = `rgb(${Math.round(140 + t * 115)},${Math.round(160 - t * 60)},${Math.round(255 - t * 175)})`;
    }
    ctx.fill();

    // Ownership ring (live where visible, otherwise last known).
    if (info && info.owner >= 0) {
      ctx.beginPath();
      ctx.arc(star.x, star.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = g.players[info.owner].color;
      ctx.lineWidth = 2;
      if (!live) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // The traditional hat on your own worlds.
    if (star.owner === 0) {
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🤠', star.x, star.y - r - 8);
    }

    // Fleet pips for ships parked here.
    const present = g.ships.filter((sh) => sh.at === star.id);
    if (present.length && (live || present.some((sh) => sh.owner === 0))) {
      const owners = [...new Set(present.map((sh) => sh.owner))];
      owners.forEach((o, i) => {
        const n = present.filter((sh) => sh.owner === o).length;
        ctx.fillStyle = g.players[o].color;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('▲' + n, star.x + r + 6, star.y + 4 + i * 11);
      });
    }

    // Name label.
    ctx.fillStyle = star === this.selectedStar ? '#fff' : '#8a90a8';
    ctx.font = star === this.selectedStar ? 'bold 11px sans-serif' : '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(star.name, star.x, star.y + r + 14);

    if (star === this.selectedStar) {
      ctx.beginPath();
      ctx.arc(star.x, star.y, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },

  drawShipMarker(ctx, x, y, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  },
};

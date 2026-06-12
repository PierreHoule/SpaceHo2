// Core game model: galaxy, players, economy, tech, fleets, combat, turns.
// No DOM access here so it can be tested headless.
'use strict';

if (typeof require !== 'undefined' && typeof DATA === 'undefined') {
  global.DATA = require('./data.js');
}

const STAR_NAMES = [
  'Sol', 'Altair', 'Vega', 'Rigel', 'Deneb', 'Antares', 'Sirius', 'Procyon',
  'Capella', 'Castor', 'Pollux', 'Arcturus', 'Spica', 'Regulus', 'Mizar',
  'Polaris', 'Betelgeuse', 'Aldebaran', 'Fomalhaut', 'Canopus', 'Achernar',
  'Bellatrix', 'Alphard', 'Algol', 'Mira', 'Nunki', 'Sargas', 'Kochab',
  'Dubhe', 'Merak', 'Alioth', 'Thuban', 'Rastaban', 'Sadr', 'Atria',
  'Hamal', 'Diphda', 'Naos', 'Wezen', 'Adhara',
];

// Mulberry32 PRNG for reproducible galaxies.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

class Game {
  constructor(seed, numPlayers) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.turn = 1;
    this.nextShipId = 1;
    this.messages = [];   // messages for the human player, cleared each turn
    this.winner = null;
    this.makeGalaxy();
    this.makePlayers(numPlayers);
    this.ships = [];
    for (const p of this.players) this.spawnHomeFleet(p);
    for (const p of this.players) this.updateKnowledge(p);
  }

  // ---------- setup ----------

  makeGalaxy() {
    const g = DATA.GALAXY;
    const rng = this.rng;
    this.stars = [];
    let guard = 0;
    while (this.stars.length < g.numStars && guard++ < 5000) {
      const s = {
        x: 50 + rng() * (g.width - 100),
        y: 50 + rng() * (g.height - 100),
      };
      if (this.stars.some((o) => dist(o, s) < g.minStarDist)) continue;
      s.id = this.stars.length;
      s.name = STAR_NAMES[s.id % STAR_NAMES.length];
      s.temp = Math.round(rng() * 100);            // 0 (frozen) .. 100 (molten)
      s.gravity = Math.round((0.3 + rng() * 2.2) * 10) / 10; // 0.3 .. 2.5 g
      s.metal = Math.round(50 + rng() * 450);      // mineable reserves
      s.owner = -1;
      s.pop = 0;            // millions
      s.terraformBudget = 0; // $ per turn
      s.miningBudget = 0;    // $ per turn
      s.queue = [];          // ship types under construction
      this.stars.push(s);
    }
  }

  makePlayers(numPlayers) {
    const E = DATA.ECONOMY;
    this.players = [];
    // Pick well-separated homeworlds.
    const homes = [];
    const candidates = [...this.stars];
    for (let i = 0; i < numPlayers; i++) {
      let best = null;
      let bestScore = -1;
      for (const s of candidates) {
        if (homes.includes(s)) continue;
        const score = homes.length
          ? Math.min(...homes.map((h) => dist(h, s)))
          : dist(s, { x: 0, y: 0 });
        if (score > bestScore) { bestScore = score; best = s; }
      }
      homes.push(best);
    }
    for (let i = 0; i < numPlayers; i++) {
      const home = homes[i];
      const p = {
        id: i,
        name: DATA.PLAYERS.names[i],
        color: DATA.PLAYERS.colors[i],
        isAI: i !== 0,
        alive: true,
        money: E.startingMoney,
        metal: E.startingMetal,
        idealTemp: home.temp,
        idealGravity: home.gravity,
        tech: { range: 1, speed: 1, weapons: 1, shields: 1, mini: 1, radical: 1 },
        techProgress: { range: 0, speed: 0, weapons: 0, shields: 0, mini: 0, radical: 0 },
        techFunding: { range: 0, speed: 0, weapons: 0, shields: 0, mini: 0, radical: 0 },
        known: this.stars.map(() => null), // per-star last-seen snapshot
        homeId: home.id,
      };
      home.owner = i;
      home.pop = E.homePop;
      home.metal = E.homeMetal;
      this.players.push(p);
    }
  }

  spawnHomeFleet(p) {
    const home = this.stars[p.homeId];
    this.addShip(p, 'scout', home.id);
    this.addShip(p, 'scout', home.id);
    this.addShip(p, 'fighter', home.id);
    this.addShip(p, 'colony', home.id);
  }

  // ---------- ships ----------

  shipStats(player, type) {
    const d = DATA.SHIPS[type];
    const t = player.tech;
    return {
      atk: d.atk * t.weapons,
      hp: d.hp * t.shields,
      spd: d.spd * (1 + 0.5 * (t.speed - 1)),
      rng: d.rng * (1 + 0.5 * (t.range - 1)),
    };
  }

  shipCost(player, type) {
    const d = DATA.SHIPS[type];
    const m = Math.pow(DATA.MINI_DISCOUNT, player.tech.mini - 1);
    return { money: Math.ceil(d.cost * m), metal: Math.ceil(d.metal * m) };
  }

  addShip(player, type, starId) {
    const s = this.shipStats(player, type);
    const ship = {
      id: this.nextShipId++,
      owner: player.id,
      type,
      atk: s.atk,
      hp: s.hp,
      maxHp: s.hp,
      spd: s.spd,
      rng: s.rng,
      at: starId,    // star id when parked, null while moving
      move: null,    // {from, to, total, traveled} while in transit
      goal: null,    // final ordered destination (colony ships settle there)
    };
    this.ships.push(ship);
    return ship;
  }

  shipsAt(starId, ownerId) {
    return this.ships.filter(
      (sh) => sh.at === starId && (ownerId === undefined || sh.owner === ownerId)
    );
  }

  buildShip(player, starId, type) {
    const star = this.stars[starId];
    if (star.owner !== player.id) return 'Not your planet';
    const cost = this.shipCost(player, type);
    // Metal shortfalls are covered by buying on the galactic market.
    const shortfall = Math.max(0, cost.metal - player.metal);
    const totalMoney = cost.money + shortfall * DATA.ECONOMY.metalBuyPrice;
    if (player.money < totalMoney) {
      return shortfall > 0
        ? `Need $${Math.ceil(totalMoney)} (includes ${Math.ceil(shortfall)} metal bought at market price)`
        : 'Not enough money';
    }
    player.money -= totalMoney;
    player.metal = Math.max(0, player.metal - cost.metal);
    star.queue.push(type);
    return null;
  }

  cancelBuild(player, starId, index) {
    const star = this.stars[starId];
    if (star.owner !== player.id || index >= star.queue.length) return;
    const type = star.queue.splice(index, 1)[0];
    const cost = this.shipCost(player, type);
    player.money += cost.money;
    player.metal += cost.metal;
  }

  // Returns null on success, error string otherwise. goalId is the final
  // destination (differs from destId when the AI routes a multi-hop trip);
  // colony ships only settle at their goal, not at waypoints.
  sendShips(shipIds, destId, goalId = destId) {
    const dest = this.stars[destId];
    const ships = this.ships.filter((sh) => shipIds.includes(sh.id));
    for (const sh of ships) {
      if (sh.at === null) return 'Ship already in transit';
      if (!DATA.SHIPS[sh.type].mobile) return `${DATA.SHIPS[sh.type].name}s cannot move`;
      const d = dist(this.stars[sh.at], dest);
      if (d > sh.rng) return 'Destination out of range';
    }
    for (const sh of ships) {
      sh.goal = goalId;
      if (sh.at === destId) continue;
      sh.move = { from: sh.at, to: destId, total: dist(this.stars[sh.at], dest), traveled: 0 };
      sh.at = null;
    }
    return null;
  }

  recallShip(ship) {
    // Turn a ship around mid-flight (or before departure).
    if (!ship.move) return;
    const m = ship.move;
    ship.goal = m.from;
    if (m.traveled === 0) {
      ship.at = m.from;
      ship.move = null;
    } else {
      ship.move = { from: m.to, to: m.from, total: m.total, traveled: m.total - m.traveled };
    }
  }

  // ---------- suitability & economy ----------

  suitability(player, star) {
    const tempF = Math.max(0, 1 - Math.abs(star.temp - player.idealTemp) / 50);
    const gravF = Math.max(0, 1 - Math.abs(star.gravity - player.idealGravity) / 1.5);
    return tempF * gravF;
  }

  planetIncome(player, star) {
    return star.pop * DATA.ECONOMY.incomePerPop * this.suitability(player, star);
  }

  playerIncome(player) {
    let sum = 0;
    for (const s of this.stars) {
      if (s.owner === player.id) sum += this.planetIncome(player, s);
    }
    return sum;
  }

  techLevelCost(player, key) {
    const rad = Math.pow(DATA.RADICAL_DISCOUNT, player.tech.radical - 1);
    return DATA.TECH[key].baseCost * player.tech[key] * (key === 'radical' ? 1 : rad);
  }

  // ---------- turn resolution ----------

  endTurn() {
    this.messages = [];
    for (const p of this.players) {
      if (!p.alive) continue;
      this.collectAndSpend(p);
    }
    this.completeBuilds();
    this.moveShips();
    // Record intel on arrival, before combat: even a scout that dies in the
    // ensuing battle gets its last transmission out.
    for (const p of this.players) if (p.alive) this.updateKnowledge(p);
    this.resolveCombat();
    this.bombardAndColonize();
    this.growPopulation();
    this.attritPlanetlessFleets();
    for (const p of this.players) if (p.alive) this.advanceTech(p);
    for (const p of this.players) if (p.alive) this.updateKnowledge(p);
    this.checkVictory();
    this.turn++;
  }

  collectAndSpend(p) {
    const E = DATA.ECONOMY;
    p.money += this.playerIncome(p);
    // Research funding.
    for (const key of DATA.TECH_KEYS) {
      const spend = Math.min(p.techFunding[key], Math.max(0, p.money));
      p.money -= spend;
      p.techProgress[key] += spend;
    }
    // Per-planet terraforming and mining.
    for (const s of this.stars) {
      if (s.owner !== p.id) continue;
      if (s.terraformBudget > 0 && s.temp !== p.idealTemp) {
        const maxDegrees = Math.abs(s.temp - p.idealTemp);
        const affordable = Math.min(s.terraformBudget, p.money);
        const degrees = Math.min(maxDegrees, affordable / E.terraformCostPerDegree);
        p.money -= degrees * E.terraformCostPerDegree;
        s.temp += Math.sign(p.idealTemp - s.temp) * degrees;
        if (Math.abs(s.temp - p.idealTemp) < 0.01) s.temp = p.idealTemp;
      }
      if (s.miningBudget > 0 && s.metal > 0) {
        const affordable = Math.min(s.miningBudget, p.money);
        const mined = Math.min(s.metal, affordable * E.miningYield);
        p.money -= mined / E.miningYield;
        s.metal -= mined;
        p.metal += mined;
      }
    }
  }

  completeBuilds() {
    for (const s of this.stars) {
      if (s.owner < 0) { s.queue = []; continue; }
      const p = this.players[s.owner];
      for (const type of s.queue) this.addShip(p, type, s.id);
      if (s.queue.length && s.owner === 0) {
        this.messages.push(`${s.name}: ${s.queue.length} ship(s) completed.`);
      }
      s.queue = [];
    }
  }

  moveShips() {
    for (const sh of this.ships) {
      if (!sh.move) continue;
      sh.move.traveled += sh.spd;
      if (sh.move.traveled >= sh.move.total) {
        sh.at = sh.move.to;
        sh.move = null;
      }
    }
  }

  resolveCombat() {
    for (const star of this.stars) {
      const present = this.ships.filter((sh) => sh.at === star.id);
      const owners = [...new Set(present.map((sh) => sh.owner))];
      if (owners.length < 2) continue;
      if (!present.some((sh) => sh.atk > 0)) continue; // nobody armed
      const before = present.length;
      let rounds = 0;
      let combatants = present.slice();
      while (rounds++ < 60) {
        const live = combatants.filter((sh) => sh.hp > 0);
        const liveOwners = [...new Set(live.map((sh) => sh.owner))];
        if (liveOwners.length < 2) break;
        if (!live.some((sh) => sh.atk > 0)) break;
        // Everyone fires simultaneously at a random enemy ship.
        const dmg = new Map();
        for (const sh of live) {
          if (sh.atk <= 0) continue;
          const enemies = live.filter((e) => e.owner !== sh.owner);
          const target = enemies[Math.floor(this.rng() * enemies.length)];
          dmg.set(target, (dmg.get(target) || 0) + sh.atk);
        }
        for (const [target, d] of dmg) target.hp -= d;
      }
      const dead = combatants.filter((sh) => sh.hp <= 0);
      this.ships = this.ships.filter((sh) => sh.hp > 0);
      const survivors = this.ships.filter((sh) => sh.at === star.id);
      const humanInvolved = owners.includes(0);
      if (humanInvolved) {
        const myLost = dead.filter((sh) => sh.owner === 0).length;
        const theirLost = dead.length - myLost;
        const holder = survivors.length
          ? this.players[survivors[0].owner].name
          : 'no one';
        this.messages.push(
          `Battle at ${star.name}: you lost ${myLost}, enemy lost ${theirLost}. ` +
          `${holder === 'You' ? 'You hold' : holder + ' holds'} the system.`
        );
      }
      void before;
    }
  }

  bombardAndColonize() {
    const E = DATA.ECONOMY;
    for (const star of this.stars) {
      const present = this.ships.filter((sh) => sh.at === star.id);
      const owners = [...new Set(present.map((sh) => sh.owner))];
      // Bombardment: enemy warships orbit a planet with no defending ships.
      if (star.owner >= 0 && owners.length === 1 && owners[0] !== star.owner) {
        const atk = present.reduce((a, sh) => a + sh.atk, 0);
        if (atk > 0) {
          const kill = Math.min(star.pop, atk * E.bombardPopKill / 10);
          star.pop -= kill;
          if (star.owner === 0 || owners[0] === 0) {
            this.messages.push(
              `${this.players[owners[0]].name === 'You' ? 'Your fleet is bombarding' :
                this.players[owners[0]].name + ' is bombarding'} ${star.name} ` +
              `(population ${star.pop.toFixed(0)}M).`
            );
          }
          if (star.pop <= 0.5) {
            star.pop = 0;
            if (star.owner === 0) this.messages.push(`${star.name} has been wiped out!`);
            star.owner = -1;
            star.queue = [];
            star.terraformBudget = 0;
            star.miningBudget = 0;
          }
        }
      }
      // Colonization: a lone player's colony ship at an unowned planet settles
      // it, but only if this planet was its ordered destination (so waypoint
      // stops on a longer journey are not settled by accident).
      if (star.owner < 0 && owners.length === 1) {
        const colony = present.find(
          (sh) => sh.type === 'colony' && (sh.goal === null || sh.goal === star.id)
        );
        if (colony) {
          const p = this.players[colony.owner];
          star.owner = p.id;
          star.pop = 10;
          this.ships = this.ships.filter((sh) => sh !== colony);
          if (p.id === 0) this.messages.push(`Colony established at ${star.name}!`);
        }
      }
    }
  }

  growPopulation() {
    const E = DATA.ECONOMY;
    for (const s of this.stars) {
      if (s.owner < 0) continue;
      const p = this.players[s.owner];
      const suit = this.suitability(p, s);
      const capacity = Math.max(20, E.basePopCapacity * suit);
      if (suit <= 0.05) {
        s.pop -= s.pop * 0.05; // hostile world: population dwindles
      } else {
        s.pop += E.popGrowthRate * s.pop * suit * (1 - s.pop / capacity);
      }
      if (s.pop < 0.5 && s.id !== p.homeId) {
        s.pop = 0;
        s.owner = -1;
        s.queue = [];
      }
    }
  }

  // Fleets whose empire holds no planets run out of supplies and decay,
  // so a wiped-out player can't haunt the galaxy forever. Colony ships get
  // a grace period to find a new home.
  attritPlanetlessFleets() {
    for (const p of this.players) {
      if (!p.alive || this.stars.some((s) => s.owner === p.id)) continue;
      for (const sh of this.ships) {
        if (sh.owner !== p.id) continue;
        sh.hp -= sh.maxHp * (sh.type === 'colony' ? 0.08 : 0.2);
      }
      this.ships = this.ships.filter((sh) => sh.hp > 0);
    }
  }

  advanceTech(p) {
    for (const key of DATA.TECH_KEYS) {
      let cost = this.techLevelCost(p, key);
      while (p.techProgress[key] >= cost) {
        p.techProgress[key] -= cost;
        p.tech[key]++;
        if (p.id === 0) {
          this.messages.push(`${DATA.TECH[key].name} research reached level ${p.tech[key]}!`);
        }
        cost = this.techLevelCost(p, key);
      }
    }
  }

  updateKnowledge(p) {
    for (const s of this.stars) {
      const visible = s.owner === p.id || this.ships.some(
        (sh) => sh.owner === p.id && (sh.at === s.id ||
          (sh.move && (sh.move.to === s.id) && sh.move.total - sh.move.traveled < 1))
      );
      if (visible) {
        p.known[s.id] = {
          turn: this.turn,
          owner: s.owner,
          pop: s.pop,
          temp: s.temp,
          gravity: s.gravity,
          metal: s.metal,
        };
      }
    }
  }

  playerAlive(p) {
    return this.stars.some((s) => s.owner === p.id) ||
      this.ships.some((sh) => sh.owner === p.id && sh.type === 'colony');
  }

  checkVictory() {
    for (const p of this.players) {
      if (p.alive && !this.playerAlive(p)) {
        p.alive = false;
        this.ships = this.ships.filter((sh) => sh.owner !== p.id);
        this.messages.push(`${p.name} ${p.id === 0 ? 'have' : 'has'} been eliminated!`);
      }
    }
    const alive = this.players.filter((p) => p.alive);
    if (alive.length === 1) this.winner = alive[0];
    else if (alive.length === 0) this.winner = { name: 'No one', id: -1 };
  }
}

if (typeof module !== 'undefined') module.exports = { Game, makeRng, dist, STAR_NAMES };

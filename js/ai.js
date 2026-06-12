// AI opponents: economy management, expansion, scouting, and warfare.
'use strict';

if (typeof require !== 'undefined' && typeof DATA === 'undefined') {
  global.DATA = require('./data.js');
}

function aiTakeTurn(game, p) {
  const myStars = game.stars.filter((s) => s.owner === p.id);
  // Colony ships keep seeking a home even if the empire has lost all planets.
  aiMoveColonyShips(game, p, myStars.length === 0);
  if (!myStars.length) return;
  const income = game.playerIncome(p);

  aiSetResearch(game, p, income);
  aiSetPlanetBudgets(game, p, myStars);
  aiBuild(game, p, myStars, income);
  aiMoveScouts(game, p);
  aiMoveWarships(game, p, myStars);
}

function aiSetResearch(game, p, income) {
  // Spend a third of income on research, plus a slice of any cash stockpile.
  const budget = income * 0.35 + Math.max(0, p.money - 500) * 0.08;
  const weights = { range: 1, speed: 1, weapons: 1.3, shields: 1.3, mini: 0.7, radical: 0.9 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const key of DATA.TECH_KEYS) {
    p.techFunding[key] = (budget * weights[key]) / total;
  }
}

function aiSetPlanetBudgets(game, p, myStars) {
  for (const s of myStars) {
    s.terraformBudget = s.temp !== p.idealTemp ? 25 : 0;
    s.miningBudget = s.metal > 0 && p.metal < 400 ? 30 : 0;
  }
}

// How good a planet could become for p after terraforming temperature.
function aiPotential(game, p, star) {
  return Math.max(0, 1 - Math.abs(star.gravity - p.idealGravity) / 1.5);
}

function aiBuild(game, p, myStars, income) {
  const richest = myStars.reduce((a, b) => (b.pop > a.pop ? b : a));
  const myShips = game.ships.filter((sh) => sh.owner === p.id);
  // Old ships keep the stats they were built with; only count colony ships
  // and scouts that are reasonably close to current tech, so obsolete hulls
  // don't block replacements.
  const currentRng = game.shipStats(p, 'colony').rng;
  const colonyShips = myShips.filter(
    (sh) => sh.type === 'colony' && sh.rng >= currentRng * 0.7
  ).length;
  const warships = myShips.filter((sh) => sh.atk > 0 && DATA.SHIPS[sh.type].mobile).length;
  const scouts = myShips.filter((sh) => sh.type === 'scout').length;

  // Keep a colony ship in the pipeline while there are targets to settle.
  if (colonyShips < 2 && aiBestColonyTarget(game, p, richest)) {
    game.buildShip(p, richest.id, 'colony');
  }
  // Scouts both explore and patrol to keep intelligence fresh.
  if (scouts < 2) game.buildShip(p, richest.id, 'scout');

  // Defensive satellites on developed worlds.
  for (const s of myStars) {
    if (s.pop > 80 && game.shipsAt(s.id, p.id).filter((sh) => sh.type === 'satellite').length < 2) {
      game.buildShip(p, s.id, 'satellite');
    }
  }

  // Spend surplus on warships; fleet size scales with the economy.
  const maxWarships = 6 + income / 30;
  let built = 0;
  while (p.money > 150 && warships + built < maxWarships && built++ < 5) {
    const type = p.money > 450 && p.tech.weapons >= 4 ? 'dreadnought'
      : p.money > 220 && p.tech.weapons >= 2 ? 'destroyer' : 'fighter';
    if (game.buildShip(p, richest.id, type)) break;
  }
}

function aiBestColonyTarget(game, p, from, desperate = false) {
  let best = null;
  let bestScore = -1;
  for (const s of game.stars) {
    if (s.owner >= 0) continue;
    const known = p.known[s.id];
    if (known && known.owner >= 0 && known.owner !== p.id) continue;
    const potential = aiPotential(game, p, s);
    if (potential < (desperate ? 0.05 : 0.3)) continue;
    const score = (game.suitability(p, s) + potential) * 100 - dist(from, s) * 0.25;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// Move sh one leg toward target, stopping at an intermediate star when the
// target is beyond the ship's (build-time) range. Returns true if it moved.
function aiHopToward(game, sh, target) {
  const here = game.stars[sh.at];
  if (here.id === target.id) return false;
  if (dist(here, target) <= sh.rng) {
    return game.sendShips([sh.id], target.id, target.id) === null;
  }
  let best = null;
  let bestD = dist(here, target);
  for (const s of game.stars) {
    if (s.id === sh.at || dist(here, s) > sh.rng) continue;
    const rem = dist(s, target);
    if (rem < bestD) { bestD = rem; best = s; }
  }
  return best ? game.sendShips([sh.id], best.id, target.id) === null : false;
}

function aiMoveColonyShips(game, p, desperate = false) {
  for (const sh of game.ships) {
    if (sh.owner !== p.id || sh.type !== 'colony' || sh.at === null) continue;
    const here = game.stars[sh.at];
    if (here.owner < 0 && sh.goal === here.id) continue; // settling this turn
    const target = aiBestColonyTarget(game, p, here, desperate);
    if (target) aiHopToward(game, sh, target);
    else if (desperate && here.owner < 0) sh.goal = here.id; // settle right here
  }
}

function aiMoveScouts(game, p) {
  for (const sh of game.ships) {
    if (sh.owner !== p.id || sh.type !== 'scout' || sh.at === null) continue;
    const here = game.stars[sh.at];
    let best = null;
    let bestD = Infinity;
    for (const s of game.stars) {
      if (p.known[s.id]) continue;
      const d = dist(here, s);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) {
      // Everything explored: patrol to refresh the stalest intelligence.
      let oldest = Infinity;
      for (const s of game.stars) {
        if (s.owner === p.id || s.id === sh.at) continue;
        const age = p.known[s.id].turn;
        if (age < oldest && game.turn - age > 10) { oldest = age; best = s; }
      }
    }
    if (best) aiHopToward(game, sh, best);
  }
}

function aiMoveWarships(game, p, myStars) {
  // Gather idle warships at the strongest planet; launch a wave when massed.
  const idle = game.ships.filter(
    (sh) => sh.owner === p.id && sh.atk > 0 && DATA.SHIPS[sh.type].mobile && sh.at !== null
  );
  if (!idle.length) return;
  const muster = myStars.reduce((a, b) => (b.pop > a.pop ? b : a));

  const wave = idle.filter((sh) => sh.at === muster.id);
  let target = null;
  if (wave.length >= 8) {
    // Nearest known enemy planet.
    let bestD = Infinity;
    for (const s of game.stars) {
      const known = p.known[s.id];
      if (!known || known.owner < 0 || known.owner === p.id) continue;
      if (s.owner === p.id) continue;
      const d = dist(muster, s);
      if (d < bestD) { bestD = d; target = s; }
    }
  }

  for (const sh of idle) {
    const here = game.stars[sh.at];
    if (here.owner >= 0 && here.owner !== p.id) continue; // keep bombarding
    // Continue an attack mission already underway (set via goal), even from
    // waypoint stops, as long as the goal still looks hostile.
    if (sh.goal !== null && sh.goal !== sh.at) {
      const k = p.known[sh.goal];
      if (k && k.owner >= 0 && k.owner !== p.id) {
        aiHopToward(game, sh, game.stars[sh.goal]);
        continue;
      }
    }
    if (here.owner === p.id && here.id !== muster.id) {
      // Leave a small garrison at each colony.
      const garrison = game.shipsAt(sh.at, p.id).filter((x) => x.atk > 0).length;
      if (garrison <= 2) continue;
    }
    if (target && sh.at === muster.id) aiHopToward(game, sh, target);
    else if (sh.at !== muster.id) aiHopToward(game, sh, muster);
  }
}

if (typeof module !== 'undefined') module.exports = { aiTakeTurn };

// Headless smoke test: AI plays every empire for many turns across several
// seeds; asserts the simulation stays sane and games make progress.
'use strict';

global.DATA = require('../js/data.js');
const model = require('../js/model.js');
global.dist = model.dist;
global.Game = model.Game;
const { aiTakeTurn } = require('../js/ai.js');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
}

let wins = 0;
for (const seed of [1, 42, 1234, 98765, 555]) {
  const g = new model.Game(seed, 4);
  assert(g.stars.length >= 20, `seed ${seed}: galaxy too small (${g.stars.length})`);
  assert(g.players.length === 4, `seed ${seed}: wrong player count`);
  const homeIds = new Set(g.players.map((p) => p.homeId));
  assert(homeIds.size === 4, `seed ${seed}: duplicate homeworlds`);

  let turns = 0;
  while (!g.winner && turns++ < 300) {
    for (const p of g.players) if (p.alive) aiTakeTurn(g, p);
    g.endTurn();
    for (const p of g.players) {
      assert(Number.isFinite(p.money), `seed ${seed} t${g.turn}: money NaN for ${p.name}`);
      assert(Number.isFinite(p.metal) && p.metal >= 0, `seed ${seed} t${g.turn}: bad metal`);
    }
    for (const s of g.stars) {
      assert(Number.isFinite(s.pop) && s.pop >= 0, `seed ${seed} t${g.turn}: bad pop at ${s.name}`);
      assert(s.metal >= -0.01, `seed ${seed} t${g.turn}: negative reserves at ${s.name}`);
    }
    for (const sh of g.ships) {
      assert(sh.at !== null || sh.move, `seed ${seed} t${g.turn}: ship in limbo`);
    }
  }

  const owned = g.stars.filter((s) => s.owner >= 0).length;
  const techSum = g.players.reduce(
    (a, p) => a + DATA.TECH_KEYS.reduce((b, k) => b + p.tech[k], 0), 0);
  console.log(
    `seed ${seed}: ${turns} turns, ${owned} planets owned, ${g.ships.length} ships, ` +
    `tech sum ${techSum}, winner: ${g.winner ? g.winner.name : 'none'}`
  );
  assert(owned > 4, `seed ${seed}: no expansion happened (${owned} planets)`);
  assert(techSum > 30, `seed ${seed}: no research happened`);
  if (g.winner) wins++;
}

assert(wins >= 2, `expected most games to finish within 300 turns, got ${wins}/5`);
console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');

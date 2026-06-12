// UI integration test: load index.html in jsdom with a stubbed canvas
// context, then drive the interface like a player would.
'use strict';

const { JSDOM } = require('jsdom');
const path = require('path');

function stubCanvas(window) {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(t, prop) {
      if (prop === 'canvas') return null;
      return noop;
    },
    set() { return true; },
  });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
}

JSDOM.fromFile(path.join(__dirname, '..', 'index.html'), {
  runScripts: 'dangerously',
  resources: 'usable',
  beforeParse: stubCanvas,
}).then((dom) => {
  const { window } = dom;
  window.addEventListener('error', (e) => {
    console.error('FAIL: page error:', e.error && e.error.stack || e.message);
    process.exitCode = 1;
  });
  window.addEventListener('load', () => {
    setTimeout(() => {
      try { run(window); } catch (e) {
        console.error('FAIL:', e.stack);
        process.exitCode = 1;
      }
      console.log(process.exitCode ? 'UI TEST FAILED' : 'UI TEST PASSED');
      window.close();
    }, 50);
  });
});

function run(window) {
  const { document } = window;
  // Top-level const/class in classic scripts live in script scope, not on
  // window, so reach them via eval.
  const UI = window.eval('UI');
  const game = UI.game;
  assert(game && game.stars.length > 0, 'game initialized');
  assert(document.getElementById('status').textContent.includes('Turn'), 'status bar rendered');

  // Home planet should be selected at start with shipyard visible.
  const home = game.stars[game.players[0].homeId];
  assert(UI.selectedStar === home, 'home planet selected on start');
  const buildBtns = document.querySelectorAll('button.build');
  assert(buildBtns.length === DATA_SHIP_COUNT(window), 'shipyard buttons rendered');

  // Build a fighter, check the queue appears and money decreases.
  const moneyBefore = game.players[0].money;
  [...buildBtns].find((b) => b.dataset.type === 'fighter').click();
  assert(home.queue.includes('fighter'), 'fighter queued');
  assert(game.players[0].money < moneyBefore, 'money deducted for build');

  // Cancel it via the queue chip; money refunded.
  document.querySelector('.queue-item').click();
  assert(home.queue.length === 0, 'build canceled');
  assert(Math.abs(game.players[0].money - moneyBefore) < 0.01, 'money refunded');

  // Fund some research via the slider.
  const slider = document.getElementById('tech-slider-weapons');
  slider.value = '30';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(game.players[0].techFunding.weapons === 30, 'tech slider sets funding');

  // Select ships and enter send mode.
  const cb = document.querySelector('input[data-ship]');
  cb.click();
  assert(UI.selectedShips.size === 1, 'ship selected via checkbox');
  document.getElementById('send-ships').click();
  assert(UI.sendMode, 'send mode armed');

  // Play 40 turns through the real Ho! button (AI plays its side).
  const ho = document.getElementById('ho-button');
  for (let i = 0; i < 40 && !game.winner; i++) ho.click();
  assert(game.turn > 40, 'turns advanced via Ho! button: turn ' + game.turn);
  assert(document.getElementById('messages').children.length > 0, 'reports rendered');

  // Selecting an unexplored star shows the unexplored notice.
  const unknown = game.stars.find((s) => !game.players[0].known[s.id]);
  if (unknown) {
    UI.selectStar(unknown);
    UI.refresh();
    assert(document.getElementById('planet').textContent.includes('Unexplored'),
      'fog of war hides unexplored planets');
  }
}

function DATA_SHIP_COUNT(window) {
  return window.eval('DATA.SHIP_KEYS.length');
}

// Entry point: create a game and hand it to the UI.
// The galaxy seed comes from `#seed=1234` in the URL when present, so a good
// galaxy can be replayed or shared; tests can preset window.__SPACEHO_SEED.
'use strict';

function chooseSeed() {
  if (typeof window.__SPACEHO_SEED === 'number') return window.__SPACEHO_SEED >>> 0;
  const m = /(?:^|[#&])seed=(\d+)/.exec(window.location.hash || '');
  if (m) return Number(m[1]) >>> 0;
  return Math.floor(Math.random() * 0xffffffff);
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game(chooseSeed(), 4); // you + 3 AI empires
  UI.init(game);
});

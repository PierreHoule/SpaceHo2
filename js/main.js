// Entry point: create a game and hand it to the UI.
'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const seed = Math.floor(Math.random() * 0xffffffff);
  const game = new Game(seed, 4); // you + 3 AI empires
  UI.init(game);
});

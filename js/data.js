// Static game data: constants, ship types, tech definitions.
'use strict';

const DATA = {
  GALAXY: {
    numStars: 30,
    width: 1000,
    height: 760,
    minStarDist: 70,
  },

  PLAYERS: {
    colors: ['#4da6ff', '#ff5050', '#66dd66', '#ffcc33', '#cc66ff', '#ff9944'],
    names: ['You', 'Zorgon', 'Krell', 'Vexis', 'Moltar', 'Quill'],
  },

  ECONOMY: {
    incomePerPop: 0.8,        // $ per million population per turn (at suitability 1)
    popGrowthRate: 0.10,      // fraction of pop per turn toward capacity
    basePopCapacity: 400,     // millions, scaled by suitability
    terraformCostPerDegree: 8,// $ to move temperature 1 unit toward ideal
    miningYield: 0.5,         // metal per $ spent (while reserves last)
    metalSellPrice: 1.0,      // $ per metal when selling surplus
    metalBuyPrice: 2.5,       // $ per metal bought on the galactic market
    bombardPopKill: 4,        // pop (millions) killed per point of orbiting attack per turn
    startingMoney: 200,
    startingMetal: 100,
    homePop: 150,
    homeMetal: 250,
  },

  // Tech: levels start at 1. Cost of going from level L to L+1 is
  // baseCost * L * radicalDiscount. Radical makes other research cheaper.
  TECH: {
    range:   { name: 'Range',   baseCost: 120, desc: 'How far ships can travel from friendly planets' },
    speed:   { name: 'Speed',   baseCost: 120, desc: 'How fast ships travel' },
    weapons: { name: 'Weapons', baseCost: 100, desc: 'Ship attack strength' },
    shields: { name: 'Shields', baseCost: 100, desc: 'Ship hit points' },
    mini:    { name: 'Mini',    baseCost: 140, desc: 'Miniaturization: cheaper ships' },
    radical: { name: 'Radical', baseCost: 200, desc: 'Makes all other research cheaper' },
  },
  TECH_KEYS: ['range', 'speed', 'weapons', 'shields', 'mini', 'radical'],
  RADICAL_DISCOUNT: 0.92,   // research cost multiplier per radical level
  MINI_DISCOUNT: 0.94,      // ship cost multiplier per mini level

  // Ship stats scale with the owner's tech at build time.
  // attack = atk * weapons level, hp = hp * shields level,
  // speed (dist/turn) = spd * (1 + 0.5*(speed level - 1)),
  // range = rng * (1 + 0.5*(range level - 1)).
  SHIPS: {
    scout:      { name: 'Scout',       cost: 15,  metal: 5,   atk: 0,  hp: 4,   spd: 90, rng: 220, mobile: true,  colony: false },
    fighter:    { name: 'Fighter',     cost: 30,  metal: 12,  atk: 4,  hp: 8,   spd: 70, rng: 170, mobile: true,  colony: false },
    destroyer:  { name: 'Destroyer',   cost: 90,  metal: 40,  atk: 12, hp: 26,  spd: 60, rng: 170, mobile: true,  colony: false },
    dreadnought:{ name: 'Dreadnought', cost: 280, metal: 130, atk: 38, hp: 90,  spd: 50, rng: 170, mobile: true,  colony: false },
    satellite:  { name: 'Satellite',   cost: 20,  metal: 10,  atk: 5,  hp: 14,  spd: 0,  rng: 0,   mobile: false, colony: false },
    colony:     { name: 'Colony Ship', cost: 60,  metal: 30,  atk: 0,  hp: 6,   spd: 60, rng: 170, mobile: true,  colony: true },
  },
  SHIP_KEYS: ['scout', 'fighter', 'destroyer', 'dreadnought', 'satellite', 'colony'],
};

if (typeof module !== 'undefined') module.exports = DATA;

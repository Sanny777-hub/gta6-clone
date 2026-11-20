// Solmar City — game configuration.
// A sun-soaked coastal city with a golden-hour palette. Values tuned by hand.

// World size in world units: a wide rectangle, roughly twice as wide as tall.
// Big enough for a city street grid, with a beach strip along the south edge.
export const WORLD = {
  width: 3200,
  height: 1600,
};

// Golden-hour palette: warm sand, terracotta roofs, teal sea, dark asphalt,
// pale sidewalks, grass, and a few building tones.
export const COLORS = {
  sand: '#e8c07a',
  sandLight: '#f2d9a4',
  terracotta: '#c96a4e',
  terracottaDark: '#a8533c',
  terracottaLight: '#e08a6a',
  sea: '#1e7a8c',
  seaDeep: '#145a66',
  seaFoam: '#9fd8c9',
  asphalt: '#2e2e30',
  sidewalk: '#b8b0a0',
  grass: '#5a8f4a',
  building: '#d9a066',
  buildingLight: '#e8c9a0',
  buildingDark: '#8a6a4a',
};

// On-foot player movement.
export const PLAYER = {
  speed: 220,      // world units per second
  radius: 14,      // body radius in world units
  maxHealth: 100,  // maximum health
};

// Car physics.
export const CAR = {
  acceleration: 320,  // world units per second squared
  maxSpeed: 520,      // world units per second
  turnRate: 2.6,      // radians per second
  length: 46,         // world units
  width: 22,          // world units
};

// Pedestrian movement.
export const PED = {
  walkSpeed: 60,  // world units per second
};

// Police pursuit.
export const POLICE = {
  carSpeed: 560,       // police car speed, world units per second
  onFootSpeed: 240,    // police on-foot speed, world units per second
  spawnDistance: 600,  // distance from the player where police spawn
};

// Wanted system. The heat value needed to reach each wanted level, and how
// many seconds without committing a crime before the wanted level decays.
export const WANTED = {
  thresholds: [10, 25, 50, 90, 140],  // heat for wanted levels 1..5
  decayDelay: 10,                     // seconds without a crime before decay
};

// The four missions, in order.
export const MISSIONS = [
  {
    id: 'hot-wheels',
    title: 'Hot Wheels',
    objective: 'Steal any car',
    reward: 300,
  },
  {
    id: 'the-package',
    title: 'The Package',
    objective: 'Drive to the marker',
    reward: 500,
  },
  {
    id: 'break-the-heat',
    title: 'Break the Heat',
    objective: 'Bring your wanted level back to zero',
    reward: 700,
  },
  {
    id: 'safehouse-drop',
    title: 'Safehouse Drop',
    objective: 'Deliver to the safehouse',
    reward: 1000,
  },
];

// Keyboard bindings.
export const KEYS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  enterCar: 'KeyE',
  action: 'KeyF',
  pause: 'KeyP',
};

// Fixed simulation step: one sixtieth of a second.
export const STEP = 1 / 60;

// localStorage key holding the best money.
export const BEST_KEY = 'solmar-best';

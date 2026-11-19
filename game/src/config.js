// Solmar City — global game constants.

export const WORLD = {
  width: 2400,
  height: 1800,
  roadSpacing: 300,      // grid pitch
  roadWidth: 64,
  sidewalkWidth: 16,
  beachBand: 240,        // bottom beach+sea band (pixels tall)
};

export const COLORS = {
  asphalt: '#3b3d42',
  roadLine: '#e9d07a',        // dashed center lines, sun-warmed yellow
  sidewalk: '#c8bfae',
  grass: '#7aa45a',
  sand: '#e7d29a',
  sea: '#2f7fa8',

  roofWarm: [
    '#b3563b',  // terracotta
    '#c98a4e',  // baked clay
    '#8a4a3d',  // dusty brick
    '#d4a15a',  // sandstone
  ],

  player: '#2f6f4e',           // deep green jacket
  policeCar: '#e8ecf1',
  trafficCars: [
    '#d9534f',
    '#f0ad4e',
    '#5bc0de',
    '#9b59b6',
    '#ecf0f1',
  ],
  pedShirts: [
    '#e67e22',
    '#3498db',
    '#1abc9c',
    '#e74c3c',
    '#f1c40f',
  ],

  hudPanel: 'rgba(18, 22, 28, 0.72)',
  minimapRoad: '#8a8f96',
  minimapMarker: '#f5d06a',
};

export const PLAYER = {
  walkSpeed: 220,   // px / s
  radius: 14,
  maxHealth: 100,
};

export const CAR = {
  accel: 500,           // px / s^2
  maxSpeed: 420,
  reverseMax: 160,
  turnRate: 2.6,        // rad / s
  length: 46,
  width: 22,
};

export const PED = {
  walkMin: 40,
  walkMax: 70,
};

export const POLICE = {
  carMaxSpeed: 460,
  footCopSpeed: 240,
  spawnInterval: 4,     // seconds
};

export const WANTED = {
  decaySeconds: 25,     // no crime + out of sight -> stars fall off
  starThresholds: [1, 2, 3, 4, 5],
};

export const MISSIONS = [
  {
    id: 'm1',
    title: 'Hot Wheels',
    objective: 'Steal any car off the street.',
    reward: 300,
  },
  {
    id: 'm2',
    title: 'The Package',
    objective: 'Pick up the package at the marked point.',
    reward: 500,
  },
  {
    id: 'm3',
    title: 'Break the Heat',
    objective: 'Shake the cops until your wanted level drops to zero.',
    reward: 700,
  },
  {
    id: 'm4',
    title: 'Safehouse Drop',
    objective: 'Deliver everything to the safehouse.',
    reward: 1000,
  },
];

export const STEP = 1 / 60;

export const BEST_KEY = 'solmar-best';

export const KEYS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  enterCar: 'KeyE',
  action: 'KeyF',
  pause: 'KeyP',
};
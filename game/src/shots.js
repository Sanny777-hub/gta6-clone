// shots.js — Solmar City screenshot staging.
//
// stageShot(scene, seed) returns { screen, state } for the four staged scenes:
// cover, drive, foot and mission. Each scene is deterministic: a fresh world is
// built from the seed and then driven forward by a scripted autopilot for a
// fixed number of fixed-timestep steps, so a given seed always produces exactly
// the same frame. Every routine runs a bounded number of steps and guards its
// lookups, so staging can never loop forever or throw, and it always settles on
// a valid, drawable state.
//
// The four scenes are staged in four different parts of the city so the
// screenshots read as four separate moments, not one frame copied four times:
// the cover is a high-speed chase in the middle of town, the drive is a cruise
// through traffic on a long straight road, the foot scene is the player on the
// sidewalk by the beach, and the mission is the player running for the package.

import { WORLD, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';

// ------------------------------------------------------------------- helpers

// Walk the on-foot player to the nearest car and get in. Walking is
// screen-aligned (up moves north), and the enter key is pressed for a bounded
// number of frames, which is enough for the world to accept the player once they
// are inside its range. Returns the car now being driven, or null when no car
// could be reached. The stolen car stays in state.cars with controlled true, so
// the renderer outlines it.
function stealNearestCar(world) {
  const state = world.state;
  let nearest = null;
  let best = Infinity;
  for (const car of state.cars) {
    const d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
    if (d < best) {
      best = d;
      nearest = car;
    }
  }
  if (nearest === null) return null;

  let steps = 0;
  while (state.player.onFoot) {
    if (steps >= 60 * 6) break;
    const dx = nearest.x - state.player.x;
    const dy = nearest.y - state.player.y;
    world.step(STEP, { up: dy < 0, down: dy > 0, left: dx < 0, right: dx > 0 });
    steps += 1;
  }

  for (let i = 0; i < 30; i += 1) {
    if (!state.player.onFoot) break;
    world.step(STEP, { enter: true });
  }
  return state.player.car;
}

// Put the player — and the car they are driving — at a grid point, facing a
// direction and at a given speed. While driving the world mirrors the car
// position onto the player, so both are set here to stay in sync (the camera,
// the minimap dot and the car all read from these).
function place(world, x, y, angle, speed) {
  const player = world.state.player;
  const px = clamp(x, 0, WORLD.width);
  const py = clamp(y, 0, WORLD.height);
  if (player.car) {
    player.car.x = px;
    player.car.y = py;
    player.car.angle = angle;
    player.car.speed = speed;
  }
  player.x = px;
  player.y = py;
  player.angle = angle;
}

// Drop a police cruiser at a point on the road, already bearing down on the
// player, so the frame shows an active pursuit rather than a distant blip.
function addPoliceCar(world, x, y, angle, speed) {
  world.state.police.push({ x, y, angle, speed, kind: 'car' });
}

// Move one of the world's own traffic cars onto a lane so there are cars
// around the player. `line` is the road centre the lane belongs to, which the
// traffic driver uses to keep the car on the road. `used` makes sure every
// staging call repositions a different car.
function placeTraffic(world, x, y, angle, speed, line, used) {
  let car = null;
  for (const c of world.state.cars) {
    if (c.controlled) continue;
    if (c.parked) continue;
    if (c.kind === 'police') continue;
    if (used.has(c)) continue;
    car = c;
    break;
  }
  if (car === null) return;
  car.x = x;
  car.y = y;
  car.angle = angle;
  car.speed = speed;
  car.main = 'h';
  car.line = line;
  car.dirSign = angle === 0 ? 1 : -1;
  car.parked = false;
  used.add(car);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function driveFor(world, frames, input) {
  for (let i = 0; i < frames; i += 1) world.step(STEP, input);
}

// ------------------------------------------------------------------- scenes

// The money shot: the player is hot at three stars and a pair of cruisers is
// closing in from behind in the middle of the city, with the package objective
// visible ahead. The world is played forward to get the player into the stolen
// car (which also flips the mission to the package run), then the chase is
// arranged and frozen before the pursuit can catch up, so the frame reads as a
// high-speed escape with the nearest cruiser clearly in the same shot.
function stageCover(world) {
  const state = world.state;
  stealNearestCar(world);
  state.wanted = 3;
  place(world, 1350, 1050, 0, 400); // roadH y=1050, heading east at ~100 km/h
  addPoliceCar(world, 1350 - 130, 1050, 0, 440); // right on our tail
  addPoliceCar(world, 1350 - 200, 1050, 0, 450); // second unit, closing fast
}

// A calm cruise down a long straight road with traffic running both ways.
// Kept well west of the mission beat so the two frames never look alike.
function stageDrive(world) {
  const state = world.state;
  stealNearestCar(world);
  state.wanted = 0;
  place(world, 900, 766, 0, 250); // south lane of roadH y=750, heading east
  const used = new Set();
  placeTraffic(world, 1350, 766, 0, 110, 750, used);
  placeTraffic(world, 1100, 734, Math.PI, 120, 750, used);
  // A short burst of throttle, then coast, settles the speedometer on a clean
  // city-cruise readout instead of pinning it at the car's top speed.
  driveFor(world, 3, { up: true });
  driveFor(world, 2, {});
  state.wanted = 0;
}

// The player on the sidewalk by the beach: clearly on foot, standing right next
// to a parked car waiting to be lifted, with pedestrians walking about and the
// sea behind them. Nothing is simulated here, so the composition is exactly the
// one that is staged.
function stageFoot(world) {
  const state = world.state;
  state.wanted = 0;
  place(world, 750, 1390, -0.24, 0); // facing the parked car to their north-east

  // A parked, uncontested car on the road just beside the player: the obvious
  // thing to steal next.
  const parked = state.cars.find((c) => !c.controlled);
  if (parked) {
    parked.x = 850;
    parked.y = 1366;
    parked.angle = 0;
    parked.speed = 0;
    parked.main = 'h';
    parked.line = 1350;
    parked.dirSign = 1;
    parked.parked = true;
  }

  // Three pedestrians a short step away, so the corner reads as lived in.
  const spots = [
    [700, 1420],
    [860, 1420],
    [940, 1330],
  ];
  for (let i = 0; i < spots.length; i += 1) {
    const ped = state.peds[i];
    if (!ped) continue;
    ped.x = spots[i][0];
    ped.y = spots[i][1];
    ped.angle = 0;
  }

  // A fixed clock value keeps the peds mid-stride and the objective ring mid
  // pulse in the frozen frame, without simulating them away from the corner.
  state.time = 1.5;
}

// The player running for the package marker, two stars on their head and a
// cruiser after them. Staged on the east side of the city, right by the
// objective, so it is a different beat from the cover chase.
function stageMission(world) {
  const state = world.state;
  stealNearestCar(world);
  state.wanted = 2;
  place(world, 1650, 1050, Math.PI / 4, 300); // square corner, bearing S.E.
  addPoliceCar(world, 1450, 1050, Math.PI / 4, 420);
  driveFor(world, 15, { up: true });
  state.wanted = 2;
}

// ------------------------------------------------------------------- public

// Stage one screenshot scene and return it ready to draw.
export function stageShot(scene, seed) {
  const world = createWorld(createRandom(seed));
  const state = world.state;

  if (scene === 'cover') stageCover(world);
  else if (scene === 'drive') stageDrive(world);
  else if (scene === 'foot') stageFoot(world);
  else if (scene === 'mission') stageMission(world);

  return { screen: 'play', state };
}
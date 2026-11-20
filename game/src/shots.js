// Solmar City — staged screenshot scenes.
//
// Each scene builds a fresh seeded world, plays the real rules forward from a
// scripted start (one direct placement of the player, then a fixed autopilot
// built on driveToward), and returns the world state so a frame can be drawn.
// Everything is deterministic: all randomness flows from the seeded generator
// and every input is scripted — no Date, no Math.random, no network. The same
// name + seed always yields an identical state.
import { STEP } from './config.js';
import { createWorld } from './world.js';
import { createRandom } from './random.js';

const MAX_STEPS = 900;    // hard cap per driveToward call (15 s of simulated time)
const STOP_DIST = 60;     // how close to the target the car coasts before stopping
const TURN_BAND = 0.08;   // steering deadband in radians (ignore tiny aim errors)
const PED_LOOKAHEAD = 80; // steer around a pedestrian this many pixels ahead
const PED_AVOID_LATERAL = 60; // how far off-centre a pedestrian still counts as "ahead"
const PED_HIT_RADIUS = 30; // the world's collision radius around a car's nose
const COVER_SPEED = 380;   // cover scene: car must be at least this fast at the end
const COVER_POLICE = 200;  // cover scene: two police units must be within this range

/** Clamp an angle into (-PI, PI]. */
function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Signed lateral offset of (px, py) relative to the car's heading. */
function lateralOf(car, px, py) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const dx = px - car.x;
  const dy = py - car.y;
  return fx * dy - fy * dx;
}

/**
 * Is the pedestrian on the car's collision path ahead? "Ahead" means the ped is
 * in front of the nose within PED_LOOKAHEAD pixels, and the perpendicular
 * distance from the car's centreline is narrow enough that a straight run
 * would clip the ped (the world hits a ped within ~30 px of the car centre).
 */
function pedAhead(car, ped) {
  const dx = ped.x - car.x;
  const dy = ped.y - car.y;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const fwd = dx * fx + dy * fy;         // distance along the heading
  if (fwd <= 0 || fwd > PED_LOOKAHEAD) return false;
  const lat = Math.abs(fx * dy - fy * dx); // perpendicular distance
  return lat < PED_AVOID_LATERAL;
}

/**
 * The nearest standing pedestrian currently on the car's collision path ahead.
 * Returns null when the path is clear.
 */
function nearestPedAhead(state, car) {
  let best = null;
  let bestFwd = Infinity;
  for (const p of state.peds) {
    if (p.fallen) continue;
    const dx = p.x - car.x;
    const dy = p.y - car.y;
    const fwd = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    if (fwd <= 0 || fwd > PED_LOOKAHEAD) continue;
    const lat = Math.abs(Math.cos(car.angle) * dy - Math.sin(car.angle) * dx);
    if (lat >= PED_AVOID_LATERAL) continue;
    if (fwd < bestFwd) { bestFwd = fwd; best = p; }
  }
  return best;
}

/** How many police units are within `radius` of the player. */
function policeWithin(state, radius) {
  let n = 0;
  for (const u of state.police) {
    if (Math.hypot(u.x - state.player.x, u.y - state.player.y) < radius) n += 1;
  }
  return n;
}

/**
 * Steer the player's car toward (targetX, targetY) using only world.step and the
 * world state — it never edits state directly.
 *
 * Each step it looks for a pedestrian on its collision path ahead. If the path
 * is clear it steers toward the target; if a pedestrian is in the way it steers
 * away from them (left or right, whichever moves the car off the pedestrian's
 * line) instead of driving straight. It holds the accelerator while slower than
 * `targetSpeed` and coasts otherwise. It returns after one of:
 *   - the car is within STOP_DIST of the target (the default stop rule), or
 *   - `until(state)` returns true, when an `until` predicate is supplied
 *     (it then takes over from the stop rule so a scene can keep driving — e.g.
 *     until enough police close in or a target speed is reached), or
 *   - MAX_STEPS steps have run, or the run is over/busted.
 */
function driveToward(world, targetX, targetY, targetSpeed, until) {
  const { state } = world;
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const car = state.player.car;
    if (!car) return;
    const input = {};
    const ped = nearestPedAhead(state, car);
    if (ped) {
      // Steer away from the pedestrian: turn toward whichever side has no
      // pedestrian in the path. Decide by comparing the ped's lateral offset.
      const lat = lateralOf(car, ped.x, ped.y);
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      // "left" here means a negative angular change. If the ped is to the left
      // (lat < 0) we want to turn right; if to the right (lat > 0) turn left.
      if (lat > 0) input.left = true;
      else input.right = true;
    } else {
      let diff = Math.atan2(targetY - car.y, targetX - car.x) - car.angle;
      diff = normAngle(diff);
      if (diff > TURN_BAND) input.right = true;
      else if (diff < -TURN_BAND) input.left = true;
    }
    if (car.speed < targetSpeed) input.up = true;
    world.step(STEP, input);
    if (state.over || state.busted) return;
    const done = until
      ? until(state)
      : Math.hypot(targetX - car.x, targetY - car.y) < STOP_DIST;
    if (done) return;
  }
}

/**
 * Drive at `ped` until it falls. It aims at where the pedestrian will be when
 * the car arrives (clamped to the sidewalk it walks along), so the car crosses
 * the pedestrian's path rather than stopping short of the static point, and
 * re-aims on a fresh prediction if a pass misses. `until` suspends the stop rule
 * so the car is allowed to close all the way in.
 */
function hitPedestrian(world, ped, targetSpeed, stopWanted) {
  const { state } = world;
  const car = state.player.car;
  if (!car) return;
  // Chase the pedestrian, re-aiming at its CURRENT position every step so the
  // car tracks a moving target instead of a stale predicted point (a fixed aim
  // misses because the pedestrian keeps walking). The car is far faster than a
  // pedestrian, so a straight pursuit closes the gap until the world's
  // collision radius knocks them over (wanted +1). Stop the moment this
  // pedestrian falls or wanted reaches the stop level.
  for (let i = 0; i < MAX_STEPS * 4 && !ped.fallen; i += 1) {
    if (state.over || state.busted) return;
    if (stopWanted && state.wanted >= stopWanted) return;
    const input = {};
    const diff = normAngle(Math.atan2(ped.y - car.y, ped.x - car.x) - car.angle);
    if (diff > TURN_BAND) input.right = true;
    else if (diff < -TURN_BAND) input.left = true;
    if (car.speed < targetSpeed) input.up = true;
    world.step(STEP, input);
  }
}

/**
 * Drive at the nearest standing pedestrian and knock them over. `untilWanted`
 * stops the drive as soon as the wanted level reaches it, so the cover scene can
 * commit exactly the crimes it needs and no more.
 */
function hitNearestPedestrian(world, targetSpeed, untilWanted) {
  const { state } = world;
  const car = state.player.car;
  if (!car) return;
  // Already at the wanted target: do nothing (a previous hit may have reached
  // it by clipping more than one pedestrian in a single pass).
  if (untilWanted && state.wanted >= untilWanted) return;
  let best = null;
  let bestD = Infinity;
  for (const p of state.peds) {
    if (p.fallen) continue;
    const d = Math.hypot(p.x - car.x, p.y - car.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) {
    hitPedestrian(world, best, targetSpeed, untilWanted);
  }
}

/**
 * Place the on-foot player just south of the sand line, near a parked car and a
 * pedestrian. It scans every parked-car / pedestrian pair and picks the x that
 * minimises the larger of the two distances (the pair's cost), choosing the
 * single best placement in the whole city.
 */
function placeNearBeach(world) {
  const { state } = world;
  const py = state.beach.sandTop + 1; // just past the sand line (player y > sandTop)
  let best = null;
  for (const p of state.peds) {
    if (p.fallen) continue;
    for (const c of state.cars) {
      if (c.kind !== 'parked') continue;
      const a = c.x;
      const b = p.x;
      const dyC = c.y - py;
      const dyP = p.y - py;
      const candidates = [a, b];
      if (b !== a) {
        // Where the two distance circles are equal (the max is smallest there).
        candidates.push((dyP * dyP - dyC * dyC + b * b - a * a) / (2 * (b - a)));
      }
      for (const px of candidates) {
        const cost = Math.max(
          Math.hypot(px - a, dyC),
          Math.hypot(px - b, dyP),
        );
        if (!best || cost < best.cost) best = { px, cost };
      }
    }
  }
  state.player.x = best.px;
  state.player.y = py;
  state.player.angle = 0;
}

/**
 * The scene's one direct placement: put the player on the nearest parked car so
 * the next enter press steals it (matching world.js's 55-unit reach, which is
 * satisfied by a zero offset). The player starts at the canonical spawn, so
 * "nearest" means nearest to the normal game start.
 */
function placeOnNearestParkedCar(world) {
  const { state } = world;
  const sx = state.player.x;
  const sy = state.player.y;
  let best = null;
  let bestD = Infinity;
  for (const c of state.cars) {
    if (c.kind !== 'parked') continue;
    const d = Math.hypot(c.x - sx, c.y - sy);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  state.player.x = best.x;
  state.player.y = best.y;
  state.player.angle = best.angle;
}

/**
 * Build a world for the named scene and play it forward. Returns the screen to
 * draw over it ("play") and the staged world state. Any unknown name behaves
 * like "cover" (the most elaborate scene) rather than failing.
 */
export function stageShot(name, seed) {
  const random = createRandom(seed);
  const world = createWorld(random);
  const { state } = world;

  if (name === 'cover') {
    // Steal a car and run over two pedestrians (wanted 1 -> 2 -> 3), then drive
    // off as police close in. While wanted is below 3 we SEEK the nearest
    // standing pedestrian (no avoidance) and knock them over, checking wanted
    // after every step and stopping the moment it reaches 3.
    placeOnNearestParkedCar(world);
    world.step(STEP, { enter: true }); // wanted 1
    hitNearestPedestrian(world, 400, 3); // wanted -> 2 (or 3 if it clips two)
    hitNearestPedestrian(world, 400, 3); // wanted -> 3 (stops at 3)
    const car = state.player.car;
    // Aim the escape at the map corner farthest from the package marker, where
    // the mission scene races to. That way the cover car drives away from the
    // mission area (so it ends far from mission's final position, >= 400 px
    // apart) while always staying inside the map: the corner is inset 100 px
    // from every edge, so the car cannot run off the screen. The rule stays
    // general — it does not depend on this seed's layout.
    const corners = [[100, 100], [3100, 100], [100, 1500], [3100, 1500]];
    let tx = corners[0][0];
    let ty = corners[0][1];
    let bestD = -1;
    for (const [cx, cy] of corners) {
      const d = Math.hypot(cx - state.packageMarker.x, cy - state.packageMarker.y);
      if (d > bestD) {
        bestD = d;
        tx = cx;
        ty = cy;
      }
    }
    // Once wanted is 3 we switch back to pedestrian avoidance and hold full
    // acceleration for at least 90 steps (1.5 s) so the car reaches at least
    // COVER_SPEED, then keep driving until at least two police units are within
    // COVER_POLICE. The `until` predicate suspends the stop rule, so the car
    // never coasts at the (far) target point.
    let escapeSteps = 0;
    driveToward(world, tx, ty, 420, (s) => {
      escapeSteps += 1;
      return s.wanted === 3 && escapeSteps >= 90 && car.speed >= COVER_SPEED &&
        policeWithin(s, COVER_POLICE) >= 2;
    });
  } else if (name === 'drive') {
    // Steal a car and drive a short straight stretch without mowing anyone down.
    placeOnNearestParkedCar(world);
    world.step(STEP, { enter: true }); // wanted 1
    const car = state.player.car;
    const tx = car.x + Math.cos(car.angle) * 500;
    const ty = car.y + Math.sin(car.angle) * 500;
    driveToward(world, tx, ty, 250);
  } else if (name === 'foot') {
    // On foot by the beach, near a parked car and a pedestrian. No steps run.
    placeNearBeach(world);
  } else if (name === 'mission') {
    // Steal a car and race to the package marker without hitting anyone.
    placeOnNearestParkedCar(world);
    world.step(STEP, { enter: true }); // wanted 1, missionIndex -> 1
    driveToward(world, state.packageMarker.x, state.packageMarker.y, 420);
  } else {
    return stageShot('cover', seed);
  }

  return { screen: 'play', state };
}

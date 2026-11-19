// Solmar City — world generation and simulation.
//
// createWorld(rand) returns { state, reset, step }. The city layout is built
// from the seeded generator, so the same seed always produces the same city.

import {
  WORLD,
  COLORS,
  PLAYER,
  CAR,
  PED,
  POLICE,
  WANTED,
  MISSIONS,
  STEP,
} from './config.js';

// Event bitmask values returned by step().
export const EVENT_OVER = 1;
export const EVENT_BUSTED = 2;
export const EVENT_MISSION = 4;

// Entity / obstacle categories.
export const KIND_CAR = 'car';
export const KIND_PED = 'ped';
export const KIND_POLICE = 'police';
export const KIND_BLOCK = 'block';

const ROAD_HALF = WORLD.roadWidth / 2;
const LANE = WORLD.roadWidth / 4; // lane offset from the road centre line
const SIDEWALK = WORLD.sidewalkWidth;
const BEACH_TOP = WORLD.height - WORLD.beachBand;
const SEA_TOP = BEACH_TOP + 120;

const TRAFFIC_CARS = 14;
const PARKED_CARS = 10;
const PED_COUNT = 24;
const STEAL_RANGE = 60;
const PUNCH_RANGE = 34;
const MARKER_RANGE = 46;
const NO_POLICE_RANGE = 300;

// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** Closest-point circle vs axis-aligned rect. Returns a push-out or null. */
function collideRect(px, py, r, rect) {
  const cx = Math.max(rect.x, Math.min(px, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(py, rect.y + rect.h));
  let dx = px - cx;
  let dy = py - cy;
  let d = Math.hypot(dx, dy);
  if (d >= r) return null;
  if (d < 1e-4) {
    dx = 0;
    dy = -1;
    d = 1;
  }
  return { nx: dx / d, ny: dy / d, push: r - d };
}

/** Push a point object out of every solid rect; sliding along walls. */
function resolveCircle(obj, solids, r) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (let i = 0; i < solids.length; i++) {
      const hit = collideRect(obj.x, obj.y, r, solids[i]);
      if (hit) {
        obj.x += hit.nx * hit.push;
        obj.y += hit.ny * hit.push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Push a vehicle (sampled at its front and rear) out of solid rects.
 * Returns true when a building was touched this frame.
 */
function collideCar(car, solids, radius, lenOffset) {
  const hx = Math.cos(car.angle) * lenOffset;
  const hy = Math.sin(car.angle) * lenOffset;
  let touched = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const sign of [1, -1]) {
      const px = car.x + hx * sign;
      const py = car.y + hy * sign;
      for (let i = 0; i < solids.length; i++) {
        const hit = collideRect(px, py, radius, solids[i]);
        if (hit) {
          car.x += hit.nx * hit.push;
          car.y += hit.ny * hit.push;
          moved = true;
          break;
        }
      }
    }
    touched = moved;
    if (!moved) break;
  }
  return touched;
}

function clampToWorld(obj, margin) {
  if (obj.x < margin) obj.x = margin;
  if (obj.x > WORLD.width - margin) obj.x = WORLD.width - margin;
  if (obj.y < margin) obj.y = margin;
  if (obj.y > WORLD.height - margin) obj.y = WORLD.height - margin;
}

function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------
// Pedestrian sidewalk walker: walks the perimeter of a block's sidewalk ring.
// ---------------------------------------------------------------------------

function sideLength(rect, side) {
  return side === 0 || side === 2 ? rect.x1 - rect.x0 : rect.y1 - rect.y0;
}

function pedFrame(rect, side, dir, t) {
  const x0 = rect.x0, y0 = rect.y0, x1 = rect.x1, y1 = rect.y1;
  if (side === 0) {
    return { x: dir > 0 ? x0 + t : x1 - t, y: y0, angle: dir > 0 ? 0 : Math.PI };
  }
  if (side === 1) {
    return { x: x1, y: dir > 0 ? y0 + t : y1 - t, angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
  if (side === 2) {
    return { x: dir > 0 ? x1 - t : x0 + t, y: y1, angle: dir > 0 ? Math.PI : 0 };
  }
  return { x: x0, y: dir > 0 ? y1 - t : y0 + t, angle: dir > 0 ? -Math.PI / 2 : Math.PI / 2 };
}

function sidewalkRect(block) {
  return {
    x0: block.x0 + SIDEWALK / 2,
    y0: block.y0 + SIDEWALK / 2,
    x1: block.x1 - SIDEWALK / 2,
    y1: block.y1 - SIDEWALK / 2,
  };
}

function stepPed(ped, dt, rng) {
  if (ped.pause > 0) {
    ped.pause -= dt;
    return;
  }
  // Idle for a moment now and then — that is the "wandering" part.
  if (rng() < 0.0015) ped.pause = rng() * 2 + 0.5;

  let t = ped.travel + ped.speed * dt;
  for (let guard = 0; guard < 8; guard++) {
    const len = sideLength(ped.rect, ped.side);
    if (t < len) break;
    t -= len;
    ped.side = (ped.side + (ped.dir > 0 ? 1 : 3)) % 4;
    if (rng() < 0.22) ped.dir *= -1; // change mind at a corner
  }
  ped.travel = t;
  const f = pedFrame(ped.rect, ped.side, ped.dir, t);
  ped.x = f.x;
  ped.y = f.y;
  ped.angle = f.angle;
}

// ---------------------------------------------------------------------------
// Traffic driver
// ---------------------------------------------------------------------------

function carAngle(car) {
  if (car.main === 'h') return car.dirSign > 0 ? 0 : Math.PI;
  return car.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2;
}

function nextCenter(centers, pos, dirSign) {
  if (dirSign > 0) {
    for (let i = 0; i < centers.length; i++) {
      if (centers[i] > pos + 2) return centers[i];
    }
    return null;
  }
  for (let i = centers.length - 1; i >= 0; i--) {
    if (centers[i] < pos - 2) return centers[i];
  }
  return null;
}

function stepTraffic(car, roadV, roadH, dt, rng) {
  const perp = car.main === 'h' ? roadV : roadH;
  const moving = car.main === 'h' ? car.x : car.y;

  const ahead = nextCenter(perp, moving, car.dirSign);
  if (ahead !== null && car.key !== ahead && Math.abs(moving - ahead) <= 12) {
    car.key = ahead;
    const atEdge = ahead === perp[0] || ahead === perp[perp.length - 1];
    if (atEdge || rng() < 0.45) {
      // Turn onto the perpendicular road at this intersection.
      const right = rng() < 0.5;
      if (car.main === 'h') {
        car.dirSign = right ? car.dirSign : -car.dirSign;
        car.main = 'v';
      } else {
        car.dirSign = right ? -car.dirSign : car.dirSign;
        car.main = 'h';
      }
      car.line = ahead;
      car.key = null;
    }
  }

  let m = moving + car.dirSign * car.speed * dt;
  const bounds = car.main === 'h' ? roadV : roadH;
  const lo = bounds[0] - 120;
  const hi = bounds[bounds.length - 1] + 120;
  if (m > hi) m = lo;
  else if (m < lo) m = hi;

  if (car.main === 'h') {
    car.x = m;
    car.y = car.line + car.dirSign * LANE;
  } else {
    car.y = m;
    car.x = car.line - car.dirSign * LANE;
  }
  car.angle = carAngle(car);
}

// ---------------------------------------------------------------------------
// City construction
// ---------------------------------------------------------------------------

function makeBuildings(block, rand, buildings) {
  const inset = SIDEWALK + 6;
  const gx0 = block.x0 + inset;
  const gy0 = block.y0 + inset;
  const gw = block.x1 - block.x0 - inset * 2;
  const gh = block.y1 - block.y0 - inset * 2;
  const gap = 10;
  const bw = Math.floor((gw - gap) / 2);
  const bh = Math.floor((gh - gap) / 2);
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      if (rand.next() < 0.12) continue; // an empty lot
      buildings.push({
        x: Math.round(gx0 + a * (bw + gap)),
        y: Math.round(gy0 + b * (bh + gap)),
        w: bw,
        h: bh,
        color: rand.pick(COLORS.roofWarm),
        kind: KIND_BLOCK,
      });
    }
  }
}

function makeSafehouse(block, rand, buildings) {
  const inset = SIDEWALK + 6;
  const x0 = block.x0 + inset;
  const y0 = block.y0 + inset;
  const iw = block.x1 - block.x0 - inset * 2;
  const ih = block.y1 - block.y0 - inset * 2;
  const w = Math.floor(iw * 0.62);
  const h = Math.floor(ih * 0.62);
  const house = {
    x: Math.round(x0),
    y: Math.round(y0),
    w,
    h,
    color: COLORS.roofWarm[0],
    kind: KIND_BLOCK,
    safehouse: true,
  };
  buildings.push(house);
  const restW = Math.max(24, iw - w - 10);
  const topH = Math.floor(ih * 0.5);
  buildings.push({
    x: Math.round(x0 + w + 10),
    y: Math.round(y0),
    w: restW,
    h: topH,
    color: rand.pick(COLORS.roofWarm),
    kind: KIND_BLOCK,
  });
  buildings.push({
    x: Math.round(x0 + w + 10),
    y: Math.round(y0 + topH + 10),
    w: restW,
    h: ih - topH - 10,
    color: rand.pick(COLORS.roofWarm),
    kind: KIND_BLOCK,
  });
  return house;
}

function buildCity(rand) {
  const vCenters = [];
  for (let x = 150; x <= WORLD.width; x += WORLD.roadSpacing) vCenters.push(x);
  const hCenters = [];
  for (let y = 150; y <= BEACH_TOP - 40; y += WORLD.roadSpacing) hCenters.push(y);

  const buildings = [];
  const blocks = [];
  const PARK = { i: 1, j: 1 };
  const PLAZA = { i: 5, j: 3 };
  const SAFE = { i: 0, j: 0 };
  let park = null;
  let plaza = null;
  let safehouse = null;

  for (let i = 0; i < vCenters.length - 1; i++) {
    for (let j = 0; j < hCenters.length - 1; j++) {
      const block = {
        i,
        j,
        x0: vCenters[i] + ROAD_HALF,
        y0: hCenters[j] + ROAD_HALF,
        x1: vCenters[i + 1] - ROAD_HALF,
        y1: hCenters[j + 1] - ROAD_HALF,
      };
      blocks.push(block);
      if (i === PARK.i && j === PARK.j) {
        park = block;
      } else if (i === PLAZA.i && j === PLAZA.j) {
        plaza = block;
      } else if (i === SAFE.i && j === SAFE.j) {
        safehouse = makeSafehouse(block, rand, buildings);
      } else {
        makeBuildings(block, rand, buildings);
      }
    }
  }

  const city = {
    roadV: vCenters,
    roadH: hCenters,
    buildings,
    blocks,
    park,
    plaza,
    safehouse,
    safehouseMarker: safehouse
      ? {
          x: safehouse.x + safehouse.w / 2,
          y: safehouse.y + safehouse.h + 10, // the front door, on the sidewalk
        }
      : { x: 200, y: 200 },
    packageMarker: plaza
      ? { x: (plaza.x0 + plaza.x1) / 2, y: (plaza.y0 + plaza.y1) / 2 }
      : { x: WORLD.width / 2, y: WORLD.height / 2 },
    beach: { sandTop: BEACH_TOP, seaTop: SEA_TOP },
  };

  // ---- traffic + parked cars -------------------------------------------------
  const cars = [];
  for (let n = 0; n < TRAFFIC_CARS; n++) {
    const main = rand.next() < 0.5 ? 'h' : 'v';
    const centers = main === 'h' ? hCenters : vCenters;
    const car = {
      x: 0,
      y: 0,
      angle: 0,
      speed: rand.range(70, 130),
      color: rand.pick(COLORS.trafficCars),
      kind: KIND_CAR,
      parked: false,
      controlled: false,
      main,
      line: rand.pick(centers),
      dirSign: rand.next() < 0.5 ? 1 : -1,
      key: null,
    };
    if (main === 'h') {
      car.x = rand.range(vCenters[0], vCenters[vCenters.length - 1]);
      car.y = car.line + car.dirSign * LANE;
    } else {
      car.y = rand.range(hCenters[0], hCenters[hCenters.length - 1]);
      car.x = car.line - car.dirSign * LANE;
    }
    car.angle = carAngle(car);
    cars.push(car);
  }

  for (let n = 0; n < PARKED_CARS; n++) {
    const car = {
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      color: rand.pick(COLORS.trafficCars),
      kind: KIND_CAR,
      parked: true,
      controlled: false,
    };
    if (rand.next() < 0.5) {
      const cx = rand.pick(vCenters);
      car.x = cx + ROAD_HALF - 14;
      car.y = rand.range(hCenters[0] + 50, BEACH_TOP - 60);
      car.angle = rand.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const cy = rand.pick(hCenters);
      car.y = cy + ROAD_HALF - 14;
      car.x = rand.range(vCenters[0] - 60, vCenters[vCenters.length - 1] + 60);
      car.angle = rand.next() < 0.5 ? 0 : Math.PI;
    }
    cars.push(car);
  }

  // ---- pedestrians -----------------------------------------------------------
  const peds = [];
  for (let n = 0; n < PED_COUNT; n++) {
    const block = blocks[n % blocks.length];
    const rect = sidewalkRect(block);
    const side = rand.int(0, 3);
    const dir = rand.next() < 0.5 ? 1 : -1;
    const ped = {
      x: 0,
      y: 0,
      angle: 0,
      speed: rand.range(PED.walkMin, PED.walkMax),
      color: rand.pick(COLORS.pedShirts),
      rect,
      side,
      dir,
      travel: rand.range(0, 60),
      fallen: false,
      pause: 0,
    };
    ped.travel = Math.min(ped.travel, Math.max(0, sideLength(rect, side) - 1));
    const f = pedFrame(rect, side, dir, ped.travel);
    ped.x = f.x;
    ped.y = f.y;
    ped.angle = f.angle;
    peds.push(ped);
  }

  city.cars = cars;
  city.peds = peds;
  return city;
}

// ---------------------------------------------------------------------------
// World factory
// ---------------------------------------------------------------------------

export function createWorld(rand) {
  const state = {};

  // A world must be rebuildable from reset() (the restart button). Re-using
  // `rand` directly for the build would leave its stream advanced after a
  // playthrough, so the same seed could no longer reproduce the same city.
  // Instead the city gets its own stream, seeded from the world generator.
  const citySeed = Math.floor(rand.next() * 2 ** 31) >>> 0;
  function cityRandom() {
    let a = citySeed >>> 0;
    return {
      next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
      },
      pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
      },
      range(a, b) {
        return this.next() * (b - a) + a;
      },
    };
  }

  // Runtime randomness that does not disturb the seeded city generator.
  let simSeed = 0x2f6e2b1 >>> 0;
  function rng() {
    simSeed = (simSeed + 0x6d2b79f5) | 0;
    let t = simSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function reset() {
    simSeed = 0x2f6e2b1 >>> 0;
    const city = buildCity(cityRandom());
    Object.assign(state, city);
    state.player = {
      x: city.roadV[0] + ROAD_HALF + 8,
      y: city.roadH[0] + ROAD_HALF + 8,
      angle: 0,
      onFoot: true,
      health: PLAYER.maxHealth,
      car: null,
    };
    state.police = [];
    state.wanted = 0;
    state.money = 0;
    state.missionIndex = 0;
    state.mission = MISSIONS[0] || null;
    state.time = 0;
    state.score = 0;
    state.over = false;
    state.busted = false;
    state.noCrime = 0;
    state.spawnTimer = 0;
    state._prevEnter = false;
    state._prevAction = false;
  }

  function commitCrime(level) {
    state.noCrime = 0;
    if (level > state.wanted) state.wanted = level;
  }

  function completeMission() {
    const m = state.mission;
    if (!m) return 0;
    state.money += m.reward;
    state.missionIndex += 1;
    state.mission = MISSIONS[state.missionIndex] || null;
    return EVENT_MISSION;
  }

  function nearestStealableCar(x, y, range) {
    let best = null;
    let bestD = range;
    for (let i = 0; i < state.cars.length; i++) {
      const c = state.cars[i];
      if (c.controlled) continue;
      const d = dist(x, y, c.x, c.y);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  function nearestPoliceDistance() {
    let best = Infinity;
    const p = state.player;
    for (let i = 0; i < state.police.length; i++) {
      const u = state.police[i];
      const d = dist(p.x, p.y, u.x, u.y);
      if (d < best) best = d;
    }
    return best;
  }

  function spawnPolice() {
    const p = state.player;
    const isCar = state.police.length % 2 === 0; // alternating mix
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const vertical = rng() < 0.5;
      const centers = vertical ? state.roadV : state.roadH;
      const c = centers[Math.floor(rng() * centers.length)];
      const along = rng() * (vertical ? WORLD.height : WORLD.width);
      const off = (rng() < 0.5 ? -1 : 1) * (ROAD_HALF + 8);
      if (vertical) {
        x = c + off;
        y = Math.max(24, Math.min(BEACH_TOP - 30, along));
      } else {
        y = c + off;
        x = Math.max(24, Math.min(WORLD.width - 24, along));
      }
      if (dist(x, y, p.x, p.y) > 480) break;
    }
    state.police.push({
      x,
      y,
      angle: 0,
      speed: 0,
      kind: isCar ? 'car' : 'foot',
      cd: 0,
    });
  }

  function damagePlayer(amount) {
    const p = state.player;
    p.health = Math.max(0, p.health - amount);
    if (p.health <= 0) {
      state.over = true;
      state.busted = true;
    }
  }

  function step(dtRaw, input) {
    const dt = typeof dtRaw === 'number' && dtRaw > 0 ? dtRaw : STEP;
    const inp = input || {};
    if (state.over) return 0;

    let events = 0;
    const p = state.player;
    const enterPressed = inp.enter && !state._prevEnter;
    const actionPressed = inp.action && !state._prevAction;
    state._prevEnter = !!inp.enter;
    state._prevAction = !!inp.action;

    // ---- player ------------------------------------------------------------
    if (p.onFoot) {
      let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
        p.angle = Math.atan2(my, mx);
      }
      const stepLen = PLAYER.walkSpeed * dt;
      p.x += mx * stepLen;
      p.y += my * stepLen;
      clampToWorld(p, PLAYER.radius);
      resolveCircle(p, state.buildings, PLAYER.radius);

      if (enterPressed) {
        const car = nearestStealableCar(p.x, p.y, STEAL_RANGE);
        if (car) {
          car.controlled = true;
          car.speed = 0;
          p.car = car;
          p.onFoot = false;
          p.angle = car.angle;
          commitCrime(1);
          if (state.mission && state.mission.id === 'm1') events |= completeMission();
        }
      } else if (actionPressed) {
        let punched = false;
        for (let i = 0; i < state.peds.length; i++) {
          const ped = state.peds[i];
          if (ped.fallen) continue;
          if (dist(p.x, p.y, ped.x, ped.y) <= PUNCH_RANGE) {
            ped.fallen = true;
            ped.speed = 0;
            punched = true;
            break;
          }
        }
        if (punched) commitCrime(1);
      }
    } else {
      const c = p.car;
      let throttle = 0;
      if (inp.up) throttle = 1;
      else if (inp.down) throttle = -1;

      if (throttle > 0) {
        c.speed += CAR.accel * dt;
      } else if (throttle < 0) {
        c.speed -= CAR.accel * (c.speed > 0 ? 1.6 : 0.6) * dt;
      } else {
        c.speed -= c.speed * Math.min(1, 1.4 * dt);
      }
      if (c.speed > CAR.maxSpeed) c.speed = CAR.maxSpeed;
      if (c.speed < -CAR.reverseMax) c.speed = -CAR.reverseMax;

      const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const grip = Math.min(1, Math.abs(c.speed) / 180);
      c.angle +=
        steer * CAR.turnRate * grip * dt * (c.speed < 0 ? -1 : 1);

      c.x += Math.cos(c.angle) * c.speed * dt;
      c.y += Math.sin(c.angle) * c.speed * dt;
      clampToWorld(c, 22);
      if (collideCar(c, state.buildings, CAR.width / 2 + 2, CAR.length / 2 - 8)) {
        c.speed *= 0.35; // impact: stop hard and lose speed
      }

      p.x = c.x;
      p.y = c.y;
      p.angle = c.angle;

      // Running over pedestrians raises the heat.
      for (let i = 0; i < state.peds.length; i++) {
        const ped = state.peds[i];
        if (ped.fallen) continue;
        if (dist(c.x, c.y, ped.x, ped.y) < 32) {
          ped.fallen = true;
          ped.speed = 0;
          commitCrime(1);
        }
      }

      if (enterPressed) {
        c.controlled = false;
        c.speed = 0;
        const side = CAR.width / 2 + 22;
        p.car = null;
        p.onFoot = true;
        p.x = c.x + Math.sin(c.angle) * side;
        p.y = c.y - Math.cos(c.angle) * side;
        clampToWorld(p, PLAYER.radius);
        resolveCircle(p, state.buildings, PLAYER.radius);
      }
    }

    // ---- traffic and pedestrians --------------------------------------------
    for (let i = 0; i < state.cars.length; i++) {
      const car = state.cars[i];
      if (car.parked || car.controlled) continue;
      stepTraffic(car, state.roadV, state.roadH, dt, rng);
    }
    for (let i = 0; i < state.peds.length; i++) {
      const ped = state.peds[i];
      if (ped.fallen) continue;
      stepPed(ped, dt, rng);
    }

    // ---- wanted level -------------------------------------------------------
    const prevWanted = state.wanted;
    state.noCrime += dt;
    if (state.wanted > 0 && state.noCrime >= WANTED.decaySeconds) {
      if (nearestPoliceDistance() > NO_POLICE_RANGE) state.wanted = 0;
    }
    if (prevWanted > 0 && state.wanted === 0) {
      if (state.mission && state.mission.id === 'm3') events |= completeMission();
    }

    // ---- police ------------------------------------------------------------
    if (state.wanted > 0) {
      state.spawnTimer -= dt;
      if (state.police.length < state.wanted && state.spawnTimer <= 0) {
        spawnPolice();
        state.spawnTimer = POLICE.spawnInterval;
      }
    } else if (state.police.length > 0) {
      if (rng() < 0.002) {
        state.police.splice(Math.floor(rng() * state.police.length), 1);
      }
    }

    for (let i = 0; i < state.police.length; i++) {
      const u = state.police[i];
      const dx = p.x - u.x;
      const dy = p.y - u.y;
      const d = Math.hypot(dx, dy) || 1;
      if (u.kind === 'car') {
        const want = Math.atan2(dy, dx);
        const turn = CAR.turnRate * 0.85 * dt;
        const diff = angleDiff(want, u.angle);
        u.angle += Math.max(-turn, Math.min(turn, diff));
        u.speed += (POLICE.carMaxSpeed - u.speed) * Math.min(1, 2 * dt);
        u.x += Math.cos(u.angle) * u.speed * dt;
        u.y += Math.sin(u.angle) * u.speed * dt;
        clampToWorld(u, 22);
        if (collideCar(u, state.buildings, CAR.width / 2 + 2, CAR.length / 2 - 8)) {
          u.speed *= 0.4;
        }
      } else {
        u.speed = POLICE.footCopSpeed;
        u.x += (dx / d) * POLICE.footCopSpeed * dt;
        u.y += (dy / d) * POLICE.footCopSpeed * dt;
        u.angle = Math.atan2(dy, dx);
        clampToWorld(u, 12);
        resolveCircle(u, state.buildings, 12);
      }
      u.cd = (u.cd || 0) - dt;
    }

    for (let i = 0; i < state.police.length; i++) {
      const u = state.police[i];
      if (u.kind === 'car' && !p.onFoot && p.car) {
        if (dist(u.x, u.y, p.car.x, p.car.y) < 42) {
          p.car.speed *= 0.93; // grinding the player's car down
          if (u.cd <= 0) {
            u.cd = 0.6;
            commitCrime(2); // being clipped by the cops raises the heat
            damagePlayer(18);
          }
        }
      } else if (u.kind === 'foot' && p.onFoot) {
        if (dist(u.x, u.y, p.x, p.y) < 26 && u.cd <= 0) {
          u.cd = 0.6;
          damagePlayer(16);
        }
      }
    }

    if (state.over) return EVENT_OVER | EVENT_BUSTED;

    // ---- markers ------------------------------------------------------------
    if (state.mission) {
      if (state.mission.id === 'm2' && dist(p.x, p.y, state.packageMarker.x, state.packageMarker.y) <= MARKER_RANGE) {
        events |= completeMission();
      } else if (state.mission.id === 'm4' && dist(p.x, p.y, state.safehouseMarker.x, state.safehouseMarker.y) <= MARKER_RANGE) {
        events |= completeMission();
      }
    }

    // ---- clock, healing, score ---------------------------------------------
    state.time += dt;
    if (state.wanted === 0 && p.health > 0 && p.health < PLAYER.maxHealth) {
      p.health = Math.min(PLAYER.maxHealth, p.health + 6 * dt);
    }
    state.score = state.money;

    return events;
  }

  reset();
  return { state, reset, step };
}
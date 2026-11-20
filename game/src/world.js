// Solmar City — deterministic world simulation.
// All randomness flows through the injected `random` object (from createRandom),
// so the same seed always produces an identical city and an identical run.
// No Math.random, no Date, no network — pure arithmetic on the seed.

import { WORLD, COLORS, PLAYER, CAR, PED, POLICE, WANTED, MISSIONS } from './config.js';

// Events returned by step().
export const EVENT_OVER = 'over';
export const EVENT_BUSTED = 'busted';
export const EVENT_MISSION = 'mission';

// Kind discriminators used across the world.
export const KIND_CAR = 'car';
export const KIND_PED = 'ped';
export const KIND_POLICE = 'police';
export const KIND_BLOCK = 'block';

const ROAD_WIDTH = 44;   // road width in world units
const HALF = ROAD_WIDTH / 2;
const SIDEWALK = 18;     // sidewalk band width inside each block edge

const CAR_PALETTE = [
  '#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#e67e22', '#f1c40f',
  '#7f8c8d', '#2c3e50', '#d35400', '#16a085',
];
const PED_PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c',
  '#f39c12', '#e84393', '#00cec9', '#fd79a8',
];
const roofColors = [
  COLORS.terracotta, COLORS.terracottaDark, COLORS.terracottaLight,
  COLORS.building, COLORS.buildingLight, COLORS.buildingDark,
];

export function createWorld(random) {
  const W = WORLD.width;
  const H = WORLD.height;

  // --- city grid ---------------------------------------------------------
  // Vertical road centers (x) and horizontal road centers (y).
  const roadV = [240, 880, 1520, 2160, 2800];
  const roadH = [240, 560, 880, 1200];

  // Beach along the south edge: sand band, then sea.
  const beach = { sandTop: 1400, seaTop: 1490 };
  const gridBottom = beach.sandTop; // city/buildings stop here

  // Block bounds between road edges (roads are ROAD_WIDTH wide).
  const colBounds = [0];
  for (const v of roadV) colBounds.push(v - HALF, v + HALF);
  colBounds.push(W);
  const rowBounds = [0];
  for (const h of roadH) rowBounds.push(h - HALF, h + HALF);
  rowBounds.push(gridBottom);

  const blocks = [];
  const nCols = colBounds.length / 2;
  for (let j = 0; j < rowBounds.length / 2; j++) {
    for (let i = 0; i < nCols; i++) {
      blocks.push({
        x0: colBounds[i * 2], x1: colBounds[i * 2 + 1],
        y0: rowBounds[j * 2], y1: rowBounds[j * 2 + 1],
        i, j,
      });
    }
  }
  const idx = (i, j) => j * nCols + i;

  const parkBlock = blocks[idx(1, 1)];
  const plazaBlock = blocks[idx(3, 2)];
  const safehouseBlock = blocks[idx(2, 3)];
  const park = { x0: parkBlock.x0, y0: parkBlock.y0, x1: parkBlock.x1, y1: parkBlock.y1 };
  const plaza = { x0: plazaBlock.x0, y0: plazaBlock.y0, x1: plazaBlock.x1, y1: plazaBlock.y1 };

  // --- buildings ---------------------------------------------------------
  const buildings = [];
  let safehouse = null;
  for (const b of blocks) {
    if (b === parkBlock || b === plazaBlock) continue;
    const cx0 = b.x0 + SIDEWALK, cy0 = b.y0 + SIDEWALK;
    const cx1 = b.x1 - SIDEWALK, cy1 = b.y1 - SIDEWALK;
    const xm = (cx0 + cx1) / 2, ym = (cy0 + cy1) / 2;
    const cells = [
      [cx0, cy0, xm, ym],
      [xm, cy0, cx1, ym],
      [cx0, ym, xm, cy1],
      [xm, ym, cx1, cy1],
    ];
    let placed = 0;
    for (const cell of cells) {
      const [ax0, ay0, ax1, ay1] = cell;
      if (random.next() < 0.85) {
        const bw = (ax1 - ax0) * random.range(0.55, 0.9);
        const bh = (ay1 - ay0) * random.range(0.55, 0.9);
        const x = ax0 + (ax1 - ax0 - bw) * random.range(0.05, 0.45);
        const y = ay0 + (ay1 - ay0 - bh) * random.range(0.05, 0.45);
        buildings.push({ x, y, w: bw, h: bh, color: random.pick(roofColors), kind: KIND_BLOCK, safehouse: false });
        placed++;
      }
    }
    if (b === safehouseBlock && placed === 0) {
      // Guarantee the safehouse block holds at least one building.
      const ax0 = cx0, ay0 = cy0, ax1 = xm, ay1 = ym;
      const bw = (ax1 - ax0) * 0.8, bh = (ay1 - ay0) * 0.8;
      buildings.push({
        x: ax0 + (ax1 - ax0 - bw) * 0.2, y: ay0 + (ay1 - ay0 - bh) * 0.2,
        w: bw, h: bh, color: random.pick(roofColors), kind: KIND_BLOCK, safehouse: false,
      });
    }
  }
  // Mark the first building inside the safehouse block as the safehouse.
  for (const bl of buildings) {
    if (bl.x >= safehouseBlock.x0 && bl.x < safehouseBlock.x1 &&
        bl.y >= safehouseBlock.y0 && bl.y < safehouseBlock.y1) {
      bl.safehouse = true;
      safehouse = bl;
      break;
    }
  }
  const safehouseMarker = { x: safehouse.x + safehouse.w / 2, y: safehouse.y - 40 };
  const packageMarker = { x: (plaza.x0 + plaza.x1) / 2, y: (plaza.y0 + plaza.y1) / 2 };

  // --- player start ------------------------------------------------------
  const playerStart = { x: 1200, y: roadH[0] + HALF + SIDEWALK / 2, angle: 0 };

  // --- cars (12 parked + 12 traffic) ------------------------------------
  const initialCars = [];
  // First parked car sits right next to the player start for the opening steal.
  initialCars.push({
    x: 1160, y: roadH[0] + 11, angle: 0, speed: 0,
    color: random.pick(CAR_PALETTE), kind: 'parked', parked: true, controlled: false,
  });
  while (initialCars.length < 12) {
    const vertical = random.next() < 0.5;
    const lane = random.next() < 0.5 ? 11 : -11;
    if (vertical) {
      const v = random.pick(roadV);
      const y = random.range(60, gridBottom - 60);
      const dir = random.next() < 0.5 ? 1 : -1;
      initialCars.push({
        x: v + lane, y, angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2, speed: 0,
        color: random.pick(CAR_PALETTE), kind: 'parked', parked: true, controlled: false,
      });
    } else {
      const h = random.pick(roadH);
      const x = random.range(60, W - 60);
      const dir = random.next() < 0.5 ? 1 : -1;
      initialCars.push({
        x, y: h + lane, angle: dir > 0 ? 0 : Math.PI, speed: 0,
        color: random.pick(CAR_PALETTE), kind: 'parked', parked: true, controlled: false,
      });
    }
  }
  for (let k = 0; k < 12; k++) {
    const vertical = random.next() < 0.5;
    const lane = random.next() < 0.5 ? 11 : -11;
    const dir = random.next() < 0.5 ? 1 : -1;
    const speed = random.range(120, 220);
    if (vertical) {
      const v = random.pick(roadV);
      const y = random.range(60, gridBottom - 60);
      initialCars.push({
        x: v + lane, y, angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2, speed,
        color: random.pick(CAR_PALETTE), kind: 'traffic', parked: false, controlled: false,
        axis: 'v', dir,
      });
    } else {
      const h = random.pick(roadH);
      const x = random.range(60, W - 60);
      initialCars.push({
        x, y: h + lane, angle: dir > 0 ? 0 : Math.PI, speed,
        color: random.pick(CAR_PALETTE), kind: 'traffic', parked: false, controlled: false,
        axis: 'h', dir,
      });
    }
  }

  // --- pedestrians (24, walking on sidewalks) ----------------------------
  const initialPeds = [];
  for (let k = 0; k < 24; k++) {
    const b = random.pick(blocks);
    const edge = random.int(0, 3);
    const dir = random.next() < 0.5 ? 1 : -1;
    if (edge === 0 || edge === 1) {
      const y = edge === 0 ? b.y0 + SIDEWALK / 2 : b.y1 - SIDEWALK / 2;
      const min = b.x0 + SIDEWALK / 2, max = b.x1 - SIDEWALK / 2;
      initialPeds.push({
        x: random.range(min, max), y, angle: dir > 0 ? 0 : Math.PI,
        speed: PED.walkSpeed, color: random.pick(PED_PALETTE),
        fallen: false, axis: 'h', dir, min, max,
      });
    } else {
      const x = edge === 2 ? b.x0 + SIDEWALK / 2 : b.x1 - SIDEWALK / 2;
      const min = b.y0 + SIDEWALK / 2, max = b.y1 - SIDEWALK / 2;
      initialPeds.push({
        x, y: random.range(min, max), angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        speed: PED.walkSpeed, color: random.pick(PED_PALETTE),
        fallen: false, axis: 'v', dir, min, max,
      });
    }
  }

  // --- internal mutable simulation state ---------------------------------
  let heat = 0;               // accumulated crime heat
  let lastCrimeTime = 0;      // time of the last committed crime
  let lastDamageTime = -999;  // time of the last damage taken
  let mission3HadCrime = false; // whether a crime was committed during mission 3

  function nearestRoadV(x) {
    let best = roadV[0], bd = Math.abs(roadV[0] - x);
    for (const v of roadV) { const d = Math.abs(v - x); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  function nearestRoadH(y) {
    let best = roadH[0], bd = Math.abs(roadH[0] - y);
    for (const h of roadH) { const d = Math.abs(h - y); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  function currentLevel() {
    let lvl = 0;
    for (const t of WANTED.thresholds) if (heat >= t) lvl++;
    return lvl;
  }
  function addHeat(levels) {
    for (let i = 0; i < levels; i++) {
      const lvl = currentLevel();
      if (lvl >= 5) break;
      heat = WANTED.thresholds[lvl] + 1; // bump exactly one wanted level
    }
    lastCrimeTime = state.time;
  }

  function buildDynamic() {
    const player = {
      x: playerStart.x, y: playerStart.y, angle: playerStart.angle,
      onFoot: true, health: PLAYER.maxHealth, car: null,
    };
    return {
      player,
      cars: initialCars.map((c) => ({ ...c })),
      peds: initialPeds.map((p) => ({ ...p })),
      police: [],
      wanted: 0,
      money: 0,
      missionIndex: 0,
      mission: MISSIONS[0],
      time: 0,
      score: 0,
      over: false,
      busted: false,
      roadV,
      roadH,
      buildings,
      park,
      plaza,
      packageMarker,
      safehouseMarker,
      beach,
    };
  }

  const state = buildDynamic();

  function reset() {
    const s = buildDynamic();
    Object.assign(state.player, s.player);
    state.cars.length = 0;
    state.cars.push(...s.cars);
    state.peds.length = 0;
    state.peds.push(...s.peds);
    state.police.length = 0;
    state.wanted = 0;
    state.money = 0;
    state.missionIndex = 0;
    state.mission = MISSIONS[0];
    state.time = 0;
    state.score = 0;
    state.over = false;
    state.busted = false;
    heat = 0;
    lastCrimeTime = 0;
    lastDamageTime = -999;
    mission3HadCrime = false;
  }

  function completeMission() {
    const m = MISSIONS[state.missionIndex];
    state.money += m.reward;
    state.missionIndex += 1;
    state.mission = state.missionIndex < MISSIONS.length ? MISSIONS[state.missionIndex] : null;
    if (state.missionIndex === 2) mission3HadCrime = false; // entering "Break the Heat"
  }

  function moveTraffic(c, dt) {
    if (c.axis === 'v') {
      c.y += c.dir * c.speed * dt;
      c.angle = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      for (const h of roadH) {
        if (Math.abs(c.y - h) < c.speed * dt * 1.5) {
          if (random.next() < 0.4) {
            c.axis = 'h';
            c.dir = random.next() < 0.5 ? 1 : -1;
            c.angle = c.dir > 0 ? 0 : Math.PI;
            break;
          }
        }
      }
      if (c.y < 40) c.y = gridBottom - 40;
      else if (c.y > gridBottom - 40) c.y = 40;
    } else {
      c.x += c.dir * c.speed * dt;
      c.angle = c.dir > 0 ? 0 : Math.PI;
      for (const v of roadV) {
        if (Math.abs(c.x - v) < c.speed * dt * 1.5) {
          if (random.next() < 0.4) {
            c.axis = 'v';
            c.dir = random.next() < 0.5 ? 1 : -1;
            c.angle = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
            break;
          }
        }
      }
      if (c.x < 40) c.x = W - 40;
      else if (c.x > W - 40) c.x = 40;
    }
  }

  function spawnPolice() {
    const player = state.player;
    const index = state.police.length;
    const kind = index % 2 === 0 ? 'car' : 'foot';
    const ang = random.range(0, Math.PI * 2);
    let x = player.x + Math.cos(ang) * POLICE.spawnDistance;
    let y = player.y + Math.sin(ang) * POLICE.spawnDistance;
    x = Math.max(40, Math.min(W - 40, x));
    y = Math.max(40, Math.min(gridBottom - 40, y));
    const unit = {
      x, y, angle: 0,
      speed: kind === 'car' ? POLICE.carSpeed : POLICE.onFootSpeed,
      kind, hitCooldown: 0, axis: 'h', dir: 1,
    };
    if (kind === 'car') {
      unit.x = nearestRoadV(x);
      unit.y = nearestRoadH(y);
      unit.axis = Math.abs(unit.x - player.x) > Math.abs(unit.y - player.y) ? 'h' : 'v';
      unit.dir = unit.axis === 'h'
        ? (Math.sign(player.x - unit.x) || 1)
        : (Math.sign(player.y - unit.y) || 1);
    }
    state.police.push(unit);
  }

  function updatePolice(dt) {
    const player = state.player;
    for (const u of state.police) {
      u.hitCooldown = Math.max(0, u.hitCooldown - dt);
      const dx = player.x - u.x, dy = player.y - u.y;
      const d = Math.hypot(dx, dy) || 1;
      if (u.kind === 'foot') {
        u.x += (dx / d) * POLICE.onFootSpeed * dt;
        u.y += (dy / d) * POLICE.onFootSpeed * dt;
        u.angle = Math.atan2(dy, dx);
      } else if (d < 300) {
        // Close range: drive straight at the player.
        u.x += (dx / d) * POLICE.carSpeed * dt;
        u.y += (dy / d) * POLICE.carSpeed * dt;
        u.angle = Math.atan2(dy, dx);
      } else if (u.axis === 'v') {
        const dir = Math.sign(dy) || 1;
        u.y += dir * POLICE.carSpeed * dt;
        u.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        if (Math.abs(dy) < 24) { u.axis = 'h'; u.y = nearestRoadH(player.y); }
      } else {
        const dir = Math.sign(dx) || 1;
        u.x += dir * POLICE.carSpeed * dt;
        u.angle = dir > 0 ? 0 : Math.PI;
        if (Math.abs(dx) < 24) { u.axis = 'v'; u.x = nearestRoadV(player.x); }
      }
    }
  }

  function syncPolice() {
    const lvl = currentLevel();
    state.wanted = lvl;
    if (lvl === 0) { state.police.length = 0; return; }
    const desired = Math.min(lvl, 5);
    while (state.police.length < desired) spawnPolice();
    if (state.police.length > desired) state.police.length = desired;
  }

  function step(dt, input) {
    input = input || {};
    if (state.over || state.busted) return null;
    state.time += dt;
    let missionDone = false;
    const player = state.player;

    if (player.onFoot) {
      let mx = 0, my = 0;
      if (input.up) my -= 1;
      if (input.down) my += 1;
      if (input.left) mx -= 1;
      if (input.right) mx += 1;
      if (mx !== 0 || my !== 0) {
        const len = Math.hypot(mx, my);
        player.x += (mx / len) * PLAYER.speed * dt;
        player.y += (my / len) * PLAYER.speed * dt;
        player.angle = Math.atan2(my, mx);
      }
      if (input.enter) {
        let best = null, bestD = 55;
        for (const c of state.cars) {
          const d = Math.hypot(c.x - player.x, c.y - player.y);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best) {
          for (const c of state.cars) c.controlled = false;
          best.controlled = true;
          best.parked = false;
          player.onFoot = false;
          player.car = best;
          addHeat(1); // stealing any car raises wanted by 1
          if (state.missionIndex === 0) missionDone = true;
        }
      }
      if (input.action) {
        for (const p of state.peds) {
          if (!p.fallen && Math.hypot(p.x - player.x, p.y - player.y) < 45) p.fallen = true;
        }
      }
    } else {
      const car = player.car;
      if (input.enter) {
        // Exit the car: the player steps out to the side of the vehicle, and
        // the car becomes parked and uncontrolled. Exiting is not a crime, so
        // wanted level, health, money and mission progress are all unchanged.
        const side = car.angle - Math.PI / 2;
        const offset = CAR.width / 2 + PLAYER.radius + 6;
        player.x = Math.max(40, Math.min(W - 40, car.x + Math.cos(side) * offset));
        player.y = Math.max(40, Math.min(H - 40, car.y + Math.sin(side) * offset));
        player.angle = car.angle;
        player.onFoot = true;
        player.car = null;
        car.controlled = false;
        car.parked = true;
        car.kind = 'parked';
        car.speed = 0;
      } else {
        const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (input.up) car.speed += CAR.acceleration * dt;
        else if (input.down) {
          if (car.speed > 0) car.speed -= CAR.acceleration * dt;
          else car.speed -= CAR.acceleration * 0.6 * dt;
        } else {
          car.speed *= Math.max(0, 1 - 1.2 * dt);
          if (Math.abs(car.speed) < 2) car.speed = 0;
        }
        car.speed = Math.max(-CAR.maxSpeed * 0.5, Math.min(CAR.maxSpeed, car.speed));
        const turnFactor = Math.abs(car.speed) > 10 ? Math.sign(car.speed) : 0;
        car.angle += steer * CAR.turnRate * dt * turnFactor;
        car.x += Math.cos(car.angle) * car.speed * dt;
        car.y += Math.sin(car.angle) * car.speed * dt;
        player.x = car.x;
        player.y = car.y;
        player.angle = car.angle;
        for (const p of state.peds) {
          if (!p.fallen && Math.hypot(p.x - car.x, p.y - car.y) < 28) {
            p.fallen = true;
            addHeat(1); // hitting a pedestrian raises wanted by 1
          }
        }
      }
    }

    // Traffic cars drive along roads; parked cars and the driven car stay put.
    for (const c of state.cars) {
      if (c.controlled) continue;
      if (c.kind !== 'traffic') continue;
      moveTraffic(c, dt);
    }
    // Pedestrians walk their sidewalks and bounce at the ends.
    for (const p of state.peds) {
      if (p.fallen) continue;
      if (p.axis === 'h') {
        p.x += p.dir * p.speed * dt;
        if (p.x < p.min) { p.x = p.min; p.dir = 1; }
        else if (p.x > p.max) { p.x = p.max; p.dir = -1; }
        p.angle = p.dir > 0 ? 0 : Math.PI;
      } else {
        p.y += p.dir * p.speed * dt;
        if (p.y < p.min) { p.y = p.min; p.dir = 1; }
        else if (p.y > p.max) { p.y = p.max; p.dir = -1; }
        p.angle = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }

    updatePolice(dt);

    // Police touching the player damage health; touching an on-foot player busts them.
    for (const u of state.police) {
      const reach = u.kind === 'car' ? 30 : 24;
      if (Math.hypot(u.x - player.x, u.y - player.y) < reach) {
        player.health -= 30 * dt;
        lastDamageTime = state.time;
        if (player.onFoot) state.busted = true;
      }
    }

    // Wanted decays back toward zero once no crime has been committed.
    if (state.time - lastCrimeTime >= WANTED.decayDelay) {
      const lvl = currentLevel();
      if (lvl > 0) {
        heat = lvl === 1 ? 0 : WANTED.thresholds[lvl - 2];
        lastCrimeTime = state.time;
      }
    }
    if (heat > 0) mission3HadCrime = true;
    state.wanted = currentLevel();
    syncPolice();

    // Health regenerates slowly when not being damaged.
    if (!state.busted && state.time - lastDamageTime > 3) {
      player.health = Math.min(PLAYER.maxHealth, player.health + 4 * dt);
    }
    if (player.health <= 0) {
      player.health = 0;
      state.over = true;
    }

    // Mission chain checks.
    if (!state.over && !state.busted && !missionDone) {
      if (state.missionIndex === 1) {
        if (!player.onFoot &&
            Math.hypot(player.x - state.packageMarker.x, player.y - state.packageMarker.y) < 50) {
          missionDone = true;
        }
      } else if (state.missionIndex === 2) {
        if (mission3HadCrime && currentLevel() === 0) missionDone = true;
      } else if (state.missionIndex === 3) {
        if (!player.onFoot &&
            Math.hypot(player.x - state.safehouseMarker.x, player.y - state.safehouseMarker.y) < 50) {
          missionDone = true;
        }
      }
    }
    if (missionDone) completeMission();

    state.score = state.money; // money is the score

    if (state.over) return EVENT_OVER;
    if (state.busted) return EVENT_BUSTED;
    if (missionDone) return EVENT_MISSION;
    return null;
  }

  return { state, reset, step };
}

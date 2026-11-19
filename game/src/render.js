// render.js — Solmar City rendering.
// Paints the world, the HUD and the screens onto a canvas 2D context.
// The camera follows the player (or the player's car) and the canvas is
// sized to the browser window, scaled by the device pixel ratio so every
// line and letter stays crisp at any window size.
//
// The world layer is a sun-soaked coastal city: buildings read as blocks
// with height (roof, side faces, windows), the streets carry sidewalks,
// center dashes and crosswalks, the park and sidewalks hold trees and
// bushes, vehicles are clearly readable, and the beach shows sand tones
// and a shoreline foam line. Everything here is a pure function of the
// world state — no Math.random, no Date.now — so a given world state
// always draws an identical frame (screenshots are taken deterministically).

import { WORLD, COLORS, PLAYER, CAR, PED, POLICE, WANTED, MISSIONS, STEP } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

// ---------------------------------------------------------------- palette
// The art direction is a warm, sun-soaked modern city. COLORS is the game's
// palette; where a key exists it wins, otherwise a coherent fallback keeps
// the scene readable. Shadows, glass and dimming are translucent overlays.
const FALLBACK = {
  grass: '#7fb069',
  park: '#6c9e58',
  plaza: '#cfc9ba',
  sand: '#ecd9a4',
  sea: '#3f9bc4',
  road: '#3c3f45',
  roadLine: '#ececec',
  sidewalk: '#b9bab2',
  buildingOutline: '#2b2e33',
  shadow: 'rgba(15,20,18,0.25)',
  playerShirt: '#e74c3c',
  playerSkin: '#eec39a',
  pedOutline: '#26262b',
  hudBg: 'rgba(10,13,18,0.72)',
  hudText: '#f4f4f2',
  hudAccent: '#ffd34d',
  gold: '#ffcf3f',
  starEmpty: 'rgba(255,255,255,0.4)',
  health: '#4fd06a',
  healthLow: '#e8453a',
  policeWhite: '#f2f2f2',
  policeBlack: '#1b1d21',
  policeShirt: '#2b3a67',
  red: '#e5484d',
  blue: '#3f7fe8',
  windshield: 'rgba(160,200,225,0.85)',
  headlight: '#fff4c8',
  tail: '#e5484d',
  minimapBg: 'rgba(8,10,14,0.74)',
  minimapRoad: 'rgba(235,235,235,0.55)',
  minimapBorder: 'rgba(255,255,255,0.28)',
  safeSign: '#35c8d8',
  title: '#ffffff',
};

function pal(name) {
  if (COLORS && COLORS[name] != null) return COLORS[name];
  if (FALLBACK[name] != null) return FALLBACK[name];
  return '#888888';
}

// ------------------------------------------------- decorative palette
// Cosmetic colors for the polish pass. Purely visual and self-contained —
// no new files, no new dependencies, no config changes.
const DECOR = {
  windowLit: 'rgba(255,224,150,0.92)',   // a lit window, warm glow
  windowDark: 'rgba(28,32,42,0.60)',      // an unlit window
  wallShade: 'rgba(18,22,30,0.42)',       // darker side face of a building
  roofLight: 'rgba(255,255,255,0.10)',    // roof tone variation: lighter
  roofDark: 'rgba(0,0,0,0.10)',           // roof tone variation: darker
  parapet: 'rgba(255,255,255,0.16)',      // roof inner edge
  topEdge: 'rgba(255,255,255,0.30)',      // sunlit top-left roof edge
  trunk: '#6b4a2f',
  canopyA: '#5f9e4d',
  canopyB: '#79b55c',
  canopyC: '#4c8c45',
  bushA: '#6faf52',
  bushB: '#5c9c48',
  treeShadow: 'rgba(20,30,20,0.18)',
  crosswalk: 'rgba(240,240,235,0.72)',
  curb: 'rgba(255,255,255,0.30)',
  foam: 'rgba(255,255,255,0.55)',
  sandLight: '#f2e3b4',
  sandDark: '#dcc489',
  seaBand: 'rgba(255,255,255,0.10)',
  playerCar: '#ff2e88',                   // bright, distinct from traffic
  carOutline: 'rgba(0,0,0,0.30)',
  playerOutline: 'rgba(255,255,255,0.92)',
};

// Deterministic 2D hash -> [0, 1). A pure function of the coordinates, so a
// given building or tree always gets the same tone / pattern every frame.
function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// ---------------------------------------------------------------- world size
const WORLD_W = (WORLD && WORLD.width) || 2000;
const WORLD_H = (WORLD && WORLD.height) || 1400;
const ROAD_W = (WORLD && WORLD.roadWidth) || 44;
const SIDE_W = (WORLD && WORLD.sidewalkWidth) || 10;

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function font(px, weight) {
  return (weight || 600) + ' ' + px + 'px ' + FONT_STACK;
}

// Rounded-rectangle path (avoids relying on ctx.roundRect so every canvas
// works the same). r is clamped to keep the corners valid on slim shapes.
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

// A diamond (rotated square) path, used for mission markers.
function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

// A five-point star path; inner is the inner-radius ratio.
function starPath(ctx, cx, cy, r, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function star(ctx, cx, cy, r, color) {
  starPath(ctx, cx, cy, r, 0.5);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function starOutline(ctx, cx, cy, r) {
  starPath(ctx, cx, cy, r, 0.5);
  ctx.strokeStyle = pal('starEmpty');
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ---------------------------------------------------------------- objective
// Which marker is the current objective. Mission text decides (the safehouse
// is where a parcel is delivered; the package marker is where one is picked
// up), with a distance fallback when the text is unhelpful.
function objectivePoint(world) {
  if (!world.mission) return null;
  const m = world.mission;
  const text = ((m.id || '') + ' ' + (m.title || '') + ' ' + (m.text || '')).toLowerCase();
  if (/safe|house|home/.test(text) && world.safehouseMarker) return world.safehouseMarker;
  if (/pack|parcel|deliver|courier|drop/.test(text) && world.packageMarker) return world.packageMarker;
  const p = world.player || {};
  const px = p.x || 0;
  const py = p.y || 0;
  const d = (mk) => (mk ? Math.hypot(mk.x - px, mk.y - py) : -1);
  const dp = world.packageMarker ? d(world.packageMarker) : -1;
  const ds = world.safehouseMarker ? d(world.safehouseMarker) : -1;
  if (dp < 0 && ds < 0) return null;
  return dp >= ds ? world.packageMarker : world.safehouseMarker;
}

// ---------------------------------------------------------------- ground
function drawGround(ctx, world) {
  const w = WORLD_W;
  const h = WORLD_H;

  // grass base
  ctx.fillStyle = pal('grass');
  ctx.fillRect(0, 0, w, h);

  // beach band and sea along the south edge. The sand gets a couple of
  // slightly varied tones, the sea a shoreline foam line and a few subtle
  // horizontal bands, so the coast does not read as two flat color blocks.
  const beach = world.beach || {};
  const sandTop = beach.sandTop != null ? beach.sandTop : h;
  const seaTop = beach.seaTop != null ? beach.seaTop : h;
  const sTop = Math.min(sandTop, seaTop);
  const sBot = Math.max(sandTop, seaTop);
  if (sBot < h) {
    ctx.fillStyle = pal('sand');
    ctx.fillRect(0, sTop, w, sBot - sTop);
    ctx.fillStyle = pal('sea');
    ctx.fillRect(0, sBot, w, h - sBot);
    if (sBot - sTop > 80) {
      // sand tonal variation
      ctx.fillStyle = DECOR.sandLight;
      ctx.fillRect(0, sTop + 26, w, 12);
      ctx.fillRect(0, sBot - 40, w, 9);
      ctx.fillStyle = DECOR.sandDark;
      ctx.fillRect(0, sTop + 64, w, 7);
      ctx.fillRect(0, sBot - 78, w, 6);
    }
    // shoreline foam highlight where the sand meets the sea
    ctx.fillStyle = DECOR.foam;
    ctx.fillRect(0, sBot - 3, w, 4);
    if (h - sBot > 80) {
      // sea banding
      ctx.fillStyle = DECOR.seaBand;
      ctx.fillRect(0, sBot + 22, w, 7);
      ctx.fillRect(0, sBot + 54, w, 5);
      ctx.fillRect(0, h - 26, w, 4);
    }
  } else if (sTop < h) {
    ctx.fillStyle = pal('sand');
    ctx.fillRect(0, sTop, w, h - sTop);
    ctx.fillStyle = DECOR.sandLight;
    ctx.fillRect(0, sTop + 26, w, 12);
    ctx.fillStyle = DECOR.sandDark;
    ctx.fillRect(0, sTop + 64, w, 7);
  }

  // park block: a quiet green square with a light cross path
  if (world.park) {
    const pk = world.park;
    ctx.fillStyle = pal('park');
    ctx.fillRect(pk.x0, pk.y0, pk.x1 - pk.x0, pk.y1 - pk.y0);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(pk.x0 + 8, (pk.y0 + pk.y1) / 2 - 6, pk.x1 - pk.x0 - 16, 12);
    ctx.fillRect((pk.x0 + pk.x1) / 2 - 6, pk.y0 + 8, 12, pk.y1 - pk.y0 - 16);
  }

  // plaza block (paved public square)
  if (world.plaza) {
    const pl = world.plaza;
    ctx.fillStyle = pal('plaza');
    ctx.fillRect(pl.x0, pl.y0, pl.x1 - pl.x0, pl.y1 - pl.y0);
  }

  const v = world.roadV || [];
  const hz = world.roadH || [];

  // sidewalks first, then roads on top so intersections render cleanly:
  // a road covers the sidewalk strips that would otherwise cross it.
  ctx.fillStyle = pal('sidewalk');
  for (const x of v) {
    ctx.fillRect(x - ROAD_W / 2 - SIDE_W, 0, SIDE_W, h);
    ctx.fillRect(x + ROAD_W / 2, 0, SIDE_W, h);
  }
  for (const y of hz) {
    ctx.fillRect(0, y - ROAD_W / 2 - SIDE_W, w, SIDE_W);
    ctx.fillRect(0, y + ROAD_W / 2, w, SIDE_W);
  }

  // road bands
  ctx.fillStyle = pal('road');
  for (const x of v) ctx.fillRect(x - ROAD_W / 2, 0, ROAD_W, h);
  for (const y of hz) ctx.fillRect(0, y - ROAD_W / 2, w, ROAD_W);

  // a light curb line where each road meets its sidewalk
  ctx.fillStyle = DECOR.curb;
  for (const x of v) {
    ctx.fillRect(x - ROAD_W / 2, 0, 2, h);
    ctx.fillRect(x + ROAD_W / 2 - 2, 0, 2, h);
  }
  for (const y of hz) {
    ctx.fillRect(0, y - ROAD_W / 2, w, 2);
    ctx.fillRect(0, y + ROAD_W / 2 - 2, w, 2);
  }

  // center dashes
  ctx.strokeStyle = pal('roadLine');
  ctx.lineWidth = 2;
  if (ctx.setLineDash) ctx.setLineDash([10, 12]);
  ctx.beginPath();
  for (const x of v) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (const y of hz) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  if (ctx.setLineDash) ctx.setLineDash([]);

  // crosswalk stripes at every road crossing, on top of the center dashes
  drawCrosswalks(ctx, world);
}

// Zebra stripes on all four sides of each road intersection. The stripe long
// axis runs along the direction of traffic, exactly where pedestrians cross.
function drawCrosswalks(ctx, world) {
  const v = world.roadV || [];
  const hz = world.roadH || [];
  const half = ROAD_W / 2;
  const stripe = 5;
  const len = 8;
  const gap = 3;
  const off = 4;
  ctx.fillStyle = DECOR.crosswalk;
  for (const x of v) {
    for (const y of hz) {
      // north / south crosswalks across the vertical road
      for (const s of [-1, 1]) {
        const cy = y + s * (half + off) + (s > 0 ? 0 : -len);
        for (let px = -24; px <= 24; px += stripe + gap) {
          ctx.fillRect(x + px, cy, stripe, len);
        }
      }
      // east / west crosswalks across the horizontal road
      for (const s of [-1, 1]) {
        const cx = x + s * (half + off) + (s > 0 ? 0 : -len);
        for (let py = -24; py <= 24; py += stripe + gap) {
          ctx.fillRect(cx, y + py, len, stripe);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- buildings
function drawBuildings(ctx, world) {
  const bs = world.buildings || [];
  const wallH = 10; // the visible side face height, in pixels

  // soft drop shadows, offset to the south-east (sun from the north-west),
  // covering the roof and the side faces so each block reads as standing up
  ctx.fillStyle = pal('shadow');
  for (const b of bs) {
    ctx.fillRect(b.x + 6, b.y + 7, b.w + wallH, b.h + wallH);
  }

  for (const b of bs) {
    const bc = b.color || pal('road');

    // roof (top face)
    ctx.fillStyle = bc;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // vary the roof tone between buildings, deterministically
    const hv = hash2(b.x, b.y);
    if (hv < 0.3) {
      ctx.fillStyle = DECOR.roofLight;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else if (hv < 0.6) {
      ctx.fillStyle = DECOR.roofDark;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // south + east side faces (an L strip around the footprint), darker than
    // the roof so the block reads with height
    ctx.fillStyle = bc;
    ctx.fillRect(b.x, b.y + b.h, b.w + wallH, wallH);
    ctx.fillRect(b.x + b.w, b.y, wallH, b.h);
    ctx.fillStyle = DECOR.wallShade;
    ctx.fillRect(b.x, b.y + b.h, b.w + wallH, wallH);
    ctx.fillRect(b.x + b.w, b.y, wallH, b.h);

    // building outline
    ctx.strokeStyle = pal('buildingOutline');
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);

    // parapet highlight (inner edge) and a sunlit top-left roof edge
    ctx.strokeStyle = DECOR.parapet;
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    ctx.strokeStyle = DECOR.topEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.h);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x + b.w, b.y);
    ctx.stroke();

    // a small rooftop unit on some buildings for extra depth
    if (b.w > 30 && b.h > 30) {
      const ac = hash2(b.x + 13, b.y + 17);
      if (ac < 0.5) {
        const ax = b.x + b.w * 0.3 + ac * b.w * 0.3;
        const ay = b.y + b.h * 0.28 + hash2(b.x + 29, b.y + 31) * b.h * 0.3;
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(ax, ay, 9, 7);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ax, ay, 9, 7);
      }
    }

    // windows in a regular grid on the side faces: some lit, some dark
    const win = 6;
    const pitch = win + 6;
    const pad = 6;
    const n = Math.max(2, Math.floor((b.w - pad * 2) / pitch));
    const totalW = (n - 1) * pitch + win;
    const startX = b.x + (b.w - totalW) / 2;
    const wY = b.y + b.h + 2;
    for (let i = 0; i < n; i++) {
      const lit = hash2(b.x + i * 3 + 1, b.y + 3) < 0.32;
      ctx.fillStyle = lit ? DECOR.windowLit : DECOR.windowDark;
      ctx.fillRect(startX + i * pitch, wY, win, win);
    }
    const m = Math.max(2, Math.floor((b.h - pad * 2) / pitch));
    const totalH = (m - 1) * pitch + win;
    const startY = b.y + (b.h - totalH) / 2;
    const eX = b.x + b.w + 2;
    for (let j = 0; j < m; j++) {
      const lit = hash2(b.x + 7, b.y + j * 5 + 2) < 0.32;
      ctx.fillStyle = lit ? DECOR.windowLit : DECOR.windowDark;
      ctx.fillRect(eX, startY + j * pitch, win, win);
    }

    // the safehouse carries a small bright sign so it reads as a landmark
    if (b.safehouse) {
      const sw = Math.min(22, b.w * 0.32);
      const sh = Math.min(8, wallH - 2);
      const sx = b.x + b.w / 2 - sw / 2;
      const sy = b.y + b.h + 1;
      ctx.fillStyle = pal('safeSign');
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, sw, sh);
    }
  }
}

// ---------------------------------------------------------------- greenery
// Trees and bushes: trunk dot + round canopy + soft shadow underneath, drawn
// in a few varied greens. Positions and tones are deterministic per entity.
function drawTree(ctx, x, y, r, seed) {
  ctx.fillStyle = DECOR.treeShadow;
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 4, r * 1.05, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = DECOR.trunk;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  const g = seed < 0.33 ? DECOR.canopyA : seed < 0.66 ? DECOR.canopyB : DECOR.canopyC;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.5, y + r * 0.2, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.5, y + r * 0.2, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(ctx, x, y, r, seed) {
  ctx.fillStyle = DECOR.treeShadow;
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 2, r * 1.1, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = seed < 0.5 ? DECOR.bushA : DECOR.bushB;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.5, y + r * 0.3, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.5, y + r * 0.3, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawParkTrees(ctx, world) {
  const pk = world.park;
  if (!pk) return;
  const cols = 3;
  const rows = 3;
  const cw = (pk.x1 - pk.x0) / cols;
  const ch = (pk.y1 - pk.y0) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const h = hash2(pk.x0 + i * 97, pk.y0 + j * 131);
      const jx = (h - 0.5) * 16;
      const jy = (hash2(i + 5, j + 41) - 0.5) * 16;
      const tx = pk.x0 + cw * (i + 0.5) + jx;
      const ty = pk.y0 + ch * (j + 0.5) + jy;
      drawTree(ctx, tx, ty, 13 + h * 6, hash2(i + 7, j + 3));
    }
  }
  // a couple of low bushes near the park corners
  if (pk.x1 - pk.x0 > 60) {
    drawBush(ctx, pk.x0 + 18, pk.y1 - 16, 5, hash2(pk.x0 + 3, pk.y1 + 1));
    drawBush(ctx, pk.x1 - 18, pk.y0 + 16, 5, hash2(pk.x1 + 1, pk.y0 + 3));
  }
}

function drawStreetTrees(ctx, world) {
  const v = world.roadV || [];
  const hz = world.roadH || [];
  const half = ROAD_W / 2;
  const off = half + SIDE_W * 0.6;
  for (const x of v) {
    for (const y of hz) {
      const h = hash2(x + 1, y + 1);
      if (h < 0.72) continue; // most corners stay bare
      const corner = Math.floor(hash2(x + 5, y + 9) * 4);
      let tx, ty;
      if (corner === 0) { tx = x + off; ty = y + off; }
      else if (corner === 1) { tx = x - off; ty = y + off; }
      else if (corner === 2) { tx = x + off; ty = y - off; }
      else { tx = x - off; ty = y - off; }
      drawTree(ctx, tx, ty, 8 + hash2(x + 3, y + 7) * 4, hash2(x + 11, y + 13));
    }
  }
}

function drawBushes(ctx, world) {
  for (const b of world.buildings || []) {
    if (b.safehouse) continue; // keep the safehouse sign clear
    const hb = hash2(b.x + 31, b.y + 47);
    if (hb < 0.45) continue;
    const bx = b.x + 6 + hb * Math.max(4, b.w - 16);
    const by = b.y + b.h + 4;
    drawBush(ctx, bx, by, 4 + hash2(b.x + 3, b.y + 5) * 2, hash2(b.x + 9, b.y + 11));
  }
}

function drawGreenery(ctx, world) {
  drawParkTrees(ctx, world);
  drawStreetTrees(ctx, world);
  drawBushes(ctx, world);
}

// ---------------------------------------------------------------- markers
function drawMarkers(ctx, world) {
  const target = objectivePoint(world);
  if (!target) return;
  const t = world.time || 0;
  const pulse = (Math.sin(t * 4) + 1) / 2;

  // pulsing ring
  ctx.strokeStyle = pal('hudAccent');
  ctx.globalAlpha = 0.35 + pulse * 0.5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(target.x, target.y, 14 + pulse * 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // floating diamond
  const dy = target.y - 26 - Math.sin(t * 3) * 5;
  diamond(ctx, target.x, dy, 9);
  ctx.fillStyle = pal('hudAccent');
  ctx.fill();
  ctx.strokeStyle = pal('title');
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------------------------------------------------------------- peds
function drawPeds(ctx, world) {
  const t = world.time || 0;
  const r = (PED && (PED.radius || PED.size)) || 6;

  for (const ped of world.peds || []) {
    ctx.save();
    ctx.translate(ped.x, ped.y);
    if (ped.fallen) {
      // lying flat: a wide, low ellipse with the head at one end
      ctx.rotate(ped.angle || 0);
      ctx.fillStyle = ped.color || pal('playerShirt');
      ctx.strokeStyle = pal('pedOutline');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.5, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pal('playerSkin');
      ctx.beginPath();
      ctx.arc(r * 1.4, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // walking bob
      const bob = Math.sin(t * 6 + ped.x * 0.05) * 1.5;
      ctx.translate(0, -bob);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath();
      ctx.ellipse(0, bob + r * 0.7, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ped.color || pal('playerShirt');
      ctx.strokeStyle = pal('pedOutline');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pal('playerSkin');
      ctx.beginPath();
      ctx.arc(0, -r * 0.25, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // police on foot patrol the streets in a blue uniform
  for (const cop of world.police || []) {
    if (cop.kind !== 'foot') continue;
    ctx.save();
    ctx.translate(cop.x, cop.y);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.7, r * 0.9, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal('policeShirt');
    ctx.strokeStyle = pal('pedOutline');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal('policeWhite');
    ctx.beginPath();
    ctx.arc(0, -r * 0.25, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- cars
function drawCars(ctx, world) {
  const t = world.time || 0;
  const cw = (CAR && (CAR.width || CAR.w)) || 22;
  const cl = (CAR && (CAR.length || CAR.l)) || 46;

  for (const car of world.cars || []) {
    const isPolice = car.kind === 'police';
    const isPlayer = !!car.controlled;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle || 0);

    // body
    if (isPolice) {
      // dark body with a light roof so it clearly reads as a cruiser
      rr(ctx, -cl / 2, -cw / 2, cl, cw, 5);
      ctx.fillStyle = pal('policeBlack');
      ctx.fill();
      ctx.fillStyle = pal('policeWhite');
      rr(ctx, -cl * 0.24, -cw / 2 + 3, cl * 0.48, cw - 6, 3);
      ctx.fill();
    } else {
      const body = isPlayer ? DECOR.playerCar : (car.color || pal('road'));
      rr(ctx, -cl / 2, -cw / 2, cl, cw, 5);
      ctx.fillStyle = body;
      ctx.fill();
      // roof panel hint so every car (traffic and parked) reads clearly
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      rr(ctx, -cl * 0.10, -cw / 2 + 3, cl * 0.34, cw - 6, 3);
      ctx.fill();
    }

    // windshield (front, +x) and rear window
    ctx.fillStyle = pal('windshield');
    ctx.fillRect(cl / 2 - cl * 0.34, -cw / 2 + 4, cl * 0.14, cw - 8);
    ctx.fillRect(-cl / 2 + cl * 0.12, -cw / 2 + 4, cl * 0.12, cw - 8);

    // headlights and tail lights
    ctx.fillStyle = pal('headlight');
    ctx.fillRect(cl / 2 - 3, -cw / 2 + 2, 3, 5);
    ctx.fillRect(cl / 2 - 3, cw / 2 - 7, 3, 5);
    ctx.fillStyle = pal('tail');
    ctx.fillRect(-cl / 2 + 1, -cw / 2 + 2, 3, 5);
    ctx.fillRect(-cl / 2 + 1, cw / 2 - 7, 3, 5);

    // flashing red/blue light bar on the police roof
    if (isPolice) {
      const on = Math.floor(t * 6) % 2 === 0;
      ctx.fillStyle = on ? pal('red') : pal('blue');
      ctx.fillRect(-5, -cw / 2 + 4, 4, cw - 8);
      ctx.fillStyle = on ? pal('blue') : pal('red');
      ctx.fillRect(-1, -cw / 2 + 4, 4, cw - 8);
    }

    // a thin outline so every vehicle reads against the road
    rr(ctx, -cl / 2, -cw / 2, cl, cw, 5);
    ctx.strokeStyle = DECOR.carOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // the player's car gets a bright body plus a thin light outline
    if (isPlayer) {
      rr(ctx, -cl / 2 - 2.5, -cw / 2 - 2.5, cl + 5, cw + 5, 7);
      ctx.strokeStyle = DECOR.playerOutline;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- player
function drawPlayer(ctx, world) {
  const p = world.player || {};
  if (p.onFoot === false) return; // in a car, the car is drawn instead
  const r = (PLAYER && (PLAYER.radius || PLAYER.size)) || 9;
  const a = p.angle || 0;
  ctx.save();
  ctx.translate(p.x, p.y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.6, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = pal('playerShirt');
  ctx.strokeStyle = pal('pedOutline');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // head
  ctx.fillStyle = pal('playerSkin');
  ctx.beginPath();
  ctx.arc(0, -r * 0.3, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  // direction tick
  ctx.strokeStyle = pal('title');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(a) * (r + 4), Math.sin(a) * (r + 4));
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- HUD
function drawHUD(ctx, world, viewW, viewH) {
  const pad = 12;

  // top-left: money and mission objective in a dark translucent panel
  const panelW = Math.min(360, viewW * 0.5);
  const panelH = 54;
  ctx.fillStyle = pal('hudBg');
  rr(ctx, pad, pad, panelW, panelH, 8);
  ctx.fill();

  ctx.fillStyle = pal('hudAccent');
  ctx.font = font(20, 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('$' + (world.money || 0), pad + 12, pad + 8);

  ctx.fillStyle = pal('hudText');
  ctx.font = font(13, 600);
  const obj = world.mission ? world.mission.text || world.mission.title || '' : 'Free roam';
  ctx.fillText(obj, pad + 12, pad + 32);

  // top-right: wanted stars and a health bar
  const starN = (WANTED && (WANTED.max || WANTED.stars)) || 5;
  const wanted = Math.max(0, Math.min(starN, world.wanted || 0));
  const starR = 9;
  const sRight = viewW - pad - 10;
  const startX = sRight - starN * (starR * 2 + 4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < starN; i++) {
    const cx = startX + i * (starR * 2 + 4) + starR;
    if (i < wanted) star(ctx, cx, pad + 12, starR, pal('gold'));
    else starOutline(ctx, cx, pad + 12, starR);
  }

  const p = world.player || {};
  let frac = p.health != null ? p.health : 1;
  if (p.maxHealth > 0) frac = frac / p.maxHealth;
  else if (frac > 1) frac = frac / 100;
  frac = Math.max(0, Math.min(1, frac));
  const barW = 130;
  const barH = 10;
  const bx = sRight - barW;
  const by = pad + 26;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  rr(ctx, bx, by, barW, barH, 5);
  ctx.fill();
  if (frac > 0) {
    ctx.fillStyle = frac > 0.35 ? pal('health') : pal('healthLow');
    rr(ctx, bx, by, Math.max(4, barW * frac), barH, 5);
    ctx.fill();
  }

  drawMinimap(ctx, world, viewW, viewH);
  drawSpeedHint(ctx, world, viewW, viewH);
}

function drawMinimap(ctx, world, viewW, viewH) {
  const pad = 12;
  const size = Math.min(200, Math.max(120, viewW * 0.18));
  const mx = viewW - pad - size;
  const my = viewH - pad - size;
  ctx.fillStyle = pal('minimapBg');
  rr(ctx, mx, my, size, size, 6);
  ctx.fill();
  ctx.strokeStyle = pal('minimapBorder');
  ctx.lineWidth = 1;
  rr(ctx, mx, my, size, size, 6);
  ctx.stroke();

  const sx = size / WORLD_W;
  const sy = size / WORLD_H;
  const mapX = (wx) => mx + wx * sx;
  const mapY = (wy) => my + wy * sy;

  // roads
  ctx.strokeStyle = pal('minimapRoad');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of world.roadV || []) {
    ctx.moveTo(mapX(x), my);
    ctx.lineTo(mapX(x), my + size);
  }
  for (const y of world.roadH || []) {
    ctx.moveTo(mx, mapY(y));
    ctx.lineTo(mx + size, mapY(y));
  }
  ctx.stroke();

  // current mission marker
  const target = objectivePoint(world);
  if (target) {
    diamond(ctx, mapX(target.x), mapY(target.y), 5);
    ctx.fillStyle = pal('hudAccent');
    ctx.fill();
  }

  // police as flashing dots
  const t = world.time || 0;
  const on = Math.floor(t * 5) % 2 === 0;
  ctx.fillStyle = on ? pal('red') : pal('blue');
  for (const cop of world.police || []) {
    ctx.beginPath();
    ctx.arc(mapX(cop.x), mapY(cop.y), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // player as a bright dot
  const p = world.player || {};
  ctx.fillStyle = pal('title');
  ctx.beginPath();
  ctx.arc(mapX(p.x || 0), mapY(p.y || 0), 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawSpeedHint(ctx, world, viewW, viewH) {
  const pad = 12;
  const p = world.player || {};
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (p.onFoot === false && p.car) {
    // Pixels per second to kilometres per hour. The world's pixel scale is
    // about 14.4 px per metre (a 46 px car is roughly 3.2 m), so km/h is
    // px/s * 3.6 / 14.4 = px/s * 0.25: the car's 420 px/s top speed reads about
    // 105 km/h, city traffic near 117 px/s reads about 29 km/h, and a stopped
    // car reads 0 — a sensible speedometer for the city.
    const kmh = Math.round(Math.abs(p.car.speed || 0) * (3.6 / 14.4));
    ctx.fillStyle = pal('hudText');
    ctx.font = font(18, 700);
    ctx.fillText(kmh + ' km/h', pad, viewH - pad - 22);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = font(12, 500);
  ctx.fillText('WASD move · E enter car · Space punch · Esc pause', pad, viewH - pad);
}

// ---------------------------------------------------------------- screens
function dim(ctx, viewW, viewH, alpha) {
  ctx.fillStyle = 'rgba(8,10,14,' + alpha + ')';
  ctx.fillRect(0, 0, viewW, viewH);
}

function drawTitle(ctx, world, viewW, viewH, bestScore) {
  dim(ctx, viewW, viewH, 0.55);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = pal('title');
  ctx.font = font(64, 900);
  ctx.fillText('Solmar City', viewW / 2, viewH * 0.34);
  ctx.fillStyle = pal('hudAccent');
  ctx.font = font(22, 600);
  ctx.fillText('An open-world crime story', viewW / 2, viewH * 0.34 + 52);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = font(18, 600);
  ctx.fillText('Best score: ' + (bestScore || 0), viewW / 2, viewH * 0.55);
  const pulse = (Math.sin((world.time || 0) * 4) + 1) / 2;
  ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + pulse * 0.5).toFixed(3) + ')';
  ctx.font = font(20, 700);
  ctx.fillText('Press Enter to start', viewW / 2, viewH * 0.68);
}

function drawPaused(ctx, world, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pw = 340;
  const ph = 232;
  const px = viewW / 2 - pw / 2;
  const py = viewH / 2 - ph / 2;
  ctx.fillStyle = pal('hudBg');
  rr(ctx, px, py, pw, ph, 12);
  ctx.fill();
  ctx.strokeStyle = pal('minimapBorder');
  ctx.lineWidth = 2;
  rr(ctx, px, py, pw, ph, 12);
  ctx.stroke();
  ctx.fillStyle = pal('title');
  ctx.font = font(30, 800);
  ctx.fillText('Paused', viewW / 2, py + 44);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = font(15, 500);
  const lines = [
    'WASD / Arrows — Move',
    'E — Enter or exit a car',
    'Space — Punch',
    'Esc — Pause',
  ];
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], viewW / 2, py + 88 + i * 26);
  }
  ctx.fillStyle = pal('hudAccent');
  ctx.font = font(16, 600);
  ctx.fillText('Press Esc to resume', viewW / 2, py + ph - 26);
}

function drawGameOver(ctx, world, viewW, viewH) {
  dim(ctx, viewW, viewH, 0.65);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = world.busted ? pal('blue') : pal('red');
  ctx.font = font(72, 900);
  ctx.fillText(world.busted ? 'BUSTED' : 'WASTED', viewW / 2, viewH * 0.32);
  ctx.fillStyle = pal('title');
  ctx.font = font(24, 700);
  ctx.fillText('Final score: ' + (world.score || 0), viewW / 2, viewH * 0.44);
  ctx.fillStyle = pal('hudAccent');
  ctx.font = font(20, 600);
  ctx.fillText('Money: $' + (world.money || 0), viewW / 2, viewH * 0.5);
  const pulse = (Math.sin((world.time || 0) * 4) + 1) / 2;
  ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + pulse * 0.5).toFixed(3) + ')';
  ctx.font = font(20, 700);
  ctx.fillText('Press Enter to play again', viewW / 2, viewH * 0.62);
}

// ---------------------------------------------------------------- renderer
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let viewW = 0;
  let viewH = 0;
  let dpr = 1;

  const hasWindow = typeof window !== 'undefined' && typeof window.innerWidth === 'number';

  // Resize the canvas to the browser window and scale by the device pixel
  // ratio so the drawing stays crisp on high-density displays.
  function resize() {
    dpr = hasWindow ? Math.max(1, window.devicePixelRatio || 1) : 1;
    viewW = hasWindow ? window.innerWidth : canvas.clientWidth || 1280;
    viewH = hasWindow ? window.innerHeight : canvas.clientHeight || 720;
    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    if (canvas.style) {
      canvas.style.width = viewW + 'px';
      canvas.style.height = viewH + 'px';
    }
  }
  resize();
  if (hasWindow) window.addEventListener('resize', resize);

  // The camera follows the player, or the player's car while driving.
  function computeCamera(world) {
    const p = world.player || {};
    const t = p.onFoot === false && p.car ? p.car : p;
    const tx = t.x || 0;
    const ty = t.y || 0;
    let cx = tx;
    let cy = ty;
    if (WORLD_W > viewW) cx = Math.max(viewW / 2, Math.min(WORLD_W - viewW / 2, cx));
    else cx = WORLD_W / 2;
    if (WORLD_H > viewH) cy = Math.max(viewH / 2, Math.min(WORLD_H - viewH / 2, cy));
    else cy = WORLD_H / 2;
    return { x: cx, y: cy };
  }

  function draw(world, screen, bestScore) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    // world space, translated by the camera
    const cam = computeCamera(world);
    ctx.save();
    ctx.translate(Math.round(viewW / 2 - cam.x), Math.round(viewH / 2 - cam.y));
    drawGround(ctx, world);
    drawBuildings(ctx, world);
    drawGreenery(ctx, world);
    drawMarkers(ctx, world);
    drawPeds(ctx, world);
    drawCars(ctx, world);
    drawPlayer(ctx, world);
    ctx.restore();

    // HUD and screens in screen space
    if (screen === SCREEN_TITLE) {
      drawTitle(ctx, world, viewW, viewH, bestScore);
    } else if (screen === SCREEN_PAUSED) {
      drawPaused(ctx, world, viewW, viewH);
    } else if (screen === SCREEN_OVER) {
      drawGameOver(ctx, world, viewW, viewH);
    } else {
      drawHUD(ctx, world, viewW, viewH);
    }
  }

  return { draw };
}

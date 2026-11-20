// Solmar City — 2D canvas renderer.
// Draws the world with a player-following camera, the HUD, the minimap, and the
// four game screens. Pure 2D canvas API only: no assets, no images, no network.
// The camera is clamped to the world bounds; the player (or player car) is the
// focal point, so the world scrolls underneath the player.
//
// Visual style: a sun-soaked coastal city with depth. Buildings read as blocks
// with height (roof cap, side face, drop shadow, window grid), streets read as
// streets (sidewalk edges, center dashes, crosswalks), the park and streets are
// greened with trees and bushes, vehicles and pedestrians are easy to read, and
// the beach/sea have varied tones and banding. Everything is deterministic:
// no Math.random, no Date, no wall-clock time — every frame for the same world
// state is pixel-identical, so screenshots are reproducible.

import {
  WORLD, COLORS, PLAYER, CAR,
} from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

// Road / sidewalk geometry (mirrors the layout used in world.js).
const ROAD_WIDTH = 44;
const HALF_ROAD = ROAD_WIDTH / 2;

// Local palette additions not present in COLORS.
const DASH_COLOR = '#e6ddc0';
const PAVED = '#d8d2c4';
const PAVED_LINE = '#bfb9ab';
const SIDEWALK_EDGE = '#cfc7b6';
const TREES = ['#3f6f34', '#4a7c3c', '#35632c'];
const BUSH_GREENS = ['#4f7c3a', '#5f8f45', '#436a30'];
const GOLD = '#ffd23e';
const GREEN = '#4ade80';
const MAGENTA = '#ff00c8';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmtMoney(n) { return n == null ? '0' : String(n); }

// Lighten (amt > 0) or darken (amt < 0) a #rrggbb color by a fixed factor.
// Pure arithmetic on the hex channels — fully deterministic.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

// Rounded rectangle path (no dependence on ctx.roundRect).
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Five-point star path centered at (cx, cy).
function starPath(ctx, cx, cy, spikes, outerR, innerR) {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// Soft pulsing-style glow: several fading rings around a solid core.
function glowCircle(ctx, x, y, r, color) {
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = 0.10 * (4 - i);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r + i * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// Small badge label under a marker.
function label(ctx, str, x, y, color) {
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 42, y, 84, 17);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y + 2);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function cameraFor(state, viewW, viewH) {
  const p = state.player;
  let cx = p.x - viewW / 2;
  let cy = p.y - viewH / 2;
  if (viewW >= WORLD.width) cx = (WORLD.width - viewW) / 2;
  else cx = clamp(cx, 0, WORLD.width - viewW);
  if (viewH >= WORLD.height) cy = (WORLD.height - viewH) / 2;
  else cy = clamp(cy, 0, WORLD.height - viewH);
  return { cx, cy };
}

// ---------------------------------------------------------------------------
// World layers (drawn in world coordinates inside the camera transform)
// ---------------------------------------------------------------------------

// A single tree: soft shadow underneath, round canopy, sunlit highlight, and a
// dark trunk dot at the base. Fully deterministic — position is passed in.
function drawTree(ctx, x, y, r, color) {
  // Soft shadow underneath (offset a touch down-right, like the sun).
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(x + 3, y + r * 0.55, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Round canopy.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Sunlit highlight on the upper-left.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  // Dark trunk dot at the base of the foliage.
  ctx.fillStyle = '#4a3421';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.62, Math.max(2, r * 0.18), 0, Math.PI * 2);
  ctx.fill();
  // Canopy rim.
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPark(ctx, park) {
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(park.x0, park.y0, park.x1 - park.x0, park.y1 - park.y0);
  // A lighter mowed path strip through the middle of the lawn.
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(park.x0, (park.y0 + park.y1) / 2 - 6, park.x1 - park.x0, 12);
  // A tidy grid of trees.
  const cols = 5, rows = 3;
  const w = park.x1 - park.x0, h = park.y1 - park.y0;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const tx = park.x0 + (i + 0.5) * (w / cols) + (j % 2 ? 8 : -8);
      const ty = park.y0 + (j + 0.5) * (h / rows);
      drawTree(ctx, tx, ty, 16, TREES[(i + j) % TREES.length]);
    }
  }
}

function drawPlaza(ctx, plaza) {
  ctx.fillStyle = PAVED;
  ctx.fillRect(plaza.x0, plaza.y0, plaza.x1 - plaza.x0, plaza.y1 - plaza.y0);
  const cx = (plaza.x0 + plaza.x1) / 2;
  const cy = (plaza.y0 + plaza.y1) / 2;
  // Paving seams.
  ctx.strokeStyle = PAVED_LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = plaza.x0 + 40; x < plaza.x1; x += 60) {
    ctx.moveTo(x, plaza.y0);
    ctx.lineTo(x, plaza.y1);
  }
  for (let y = plaza.y0 + 40; y < plaza.y1; y += 60) {
    ctx.moveTo(plaza.x0, y);
    ctx.lineTo(plaza.x1, y);
  }
  ctx.stroke();
  // Center fountain.
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#8fb8c9';
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fill();
}

// Zebra crosswalk on all four approaches of the intersection at (v, h).
function drawCrosswalk(ctx, v, h) {
  const band = 18;
  const stripe = 3;
  const step = 8;
  ctx.fillStyle = 'rgba(230,226,212,0.82)';
  // Pedestrians crossing the vertical road: bands just north and south of the
  // intersection, made of vertical stripes.
  for (const yTop of [h - HALF_ROAD - band, h + HALF_ROAD]) {
    for (let x = v - HALF_ROAD + 2; x < v + HALF_ROAD - stripe; x += step) {
      ctx.fillRect(x, yTop, stripe, band);
    }
  }
  // Pedestrians crossing the horizontal road: bands just west and east of the
  // intersection, made of horizontal stripes.
  for (const xLeft of [v - HALF_ROAD - band, v + HALF_ROAD]) {
    for (let y = h - HALF_ROAD + 2; y < h + HALF_ROAD - stripe; y += step) {
      ctx.fillRect(xLeft, y, band, stripe);
    }
  }
}

function drawRoads(ctx, state) {
  const gridBottom = state.beach.sandTop;
  ctx.fillStyle = COLORS.asphalt;
  for (const v of state.roadV) ctx.fillRect(v - HALF_ROAD, 0, ROAD_WIDTH, gridBottom);
  for (const h of state.roadH) ctx.fillRect(0, h - HALF_ROAD, WORLD.width, ROAD_WIDTH);
  // Lighter sidewalk edge along both sides of every road, so streets read as
  // streets bounded by pale kerbs.
  ctx.fillStyle = SIDEWALK_EDGE;
  for (const v of state.roadV) {
    ctx.fillRect(v - HALF_ROAD - 5, 0, 5, gridBottom);
    ctx.fillRect(v + HALF_ROAD, 0, 5, gridBottom);
  }
  for (const h of state.roadH) {
    ctx.fillRect(0, h - HALF_ROAD - 5, WORLD.width, 5);
    ctx.fillRect(0, h + HALF_ROAD, WORLD.width, 5);
  }
  // Dashed center lines on the main roads.
  ctx.fillStyle = DASH_COLOR;
  for (const v of state.roadV) {
    for (let y = 20; y < gridBottom; y += 46) ctx.fillRect(v - 2, y, 4, 22);
  }
  for (const h of state.roadH) {
    for (let x = 20; x < WORLD.width; x += 46) ctx.fillRect(x, h - 2, 22, 4);
  }
  // Crosswalk stripes where roads cross.
  for (const v of state.roadV) {
    for (const h of state.roadH) drawCrosswalk(ctx, v, h);
  }
}

// Regular grid of windows on a building's front face. Each window is a small
// dark rectangle, except every third one which is a warm "lit" window. The
// pattern comes only from the grid indices — deterministic, no randomness.
function drawBuildingWindows(ctx, b) {
  const wallTop = b.y + b.h * 0.28;
  const wallBot = b.y + b.h - 4;
  const wallH = wallBot - wallTop;
  if (wallH < 14 || b.w < 26) return;
  const cols = Math.max(1, Math.floor((b.w - 10) / 22));
  const rows = Math.max(1, Math.floor((wallH - 6) / 26));
  const cw = (b.w - 10) / cols;
  const rh = (wallH - 6) / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const wx = b.x + 5 + c * cw + cw / 2 - 3.5;
      const wy = wallTop + 3 + r * rh + rh / 2 - 4.5;
      ctx.fillStyle = (c + r) % 3 === 0
        ? 'rgba(255,214,110,0.55)'   // lit window
        : 'rgba(0,0,0,0.28)';        // dark window
      ctx.fillRect(wx, wy, 7, 9);
    }
  }
}

function drawBuildings(ctx, buildings) {
  for (const b of buildings) {
    // Drop shadow down and to the right, so the block reads as standing up.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x + 5, b.y + 7, b.w, b.h);
    // Body wall.
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Roof cap: the top band is a lighter, sunlit tone. The roof color varies
    // per building (a deterministic tint on top of the palette's own variety),
    // so the city reads as a patchwork of roofs rather than one flat fill.
    const roofTint = (Math.floor(b.x + b.y) % 3) * 0.05;
    ctx.fillStyle = shade(b.color, 0.16 + roofTint);
    ctx.fillRect(b.x, b.y, b.w, b.h * 0.28);
    // Roof edge line separating the roof from the wall.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(b.x, b.y + b.h * 0.28 - 2, b.w, 2);
    // Darker side face down the right edge, giving the block a shaded side.
    ctx.fillStyle = shade(b.color, -0.26);
    ctx.fillRect(b.x + b.w - 5, b.y, 5, b.h);
    // Windows on the front face.
    drawBuildingWindows(ctx, b);
    // Inset outline.
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
  }
}

// A few trees along the streets, on the sidewalk band, skipping intersections.
// Placement is derived from the fixed road grid indices — deterministic.
function drawStreetTrees(ctx, state) {
  const gridBottom = state.beach.sandTop;
  for (let vi = 0; vi < state.roadV.length; vi++) {
    const v = state.roadV[vi];
    let k = 0;
    for (let y = 160; y < gridBottom - 120; y += 280, k++) {
      if (k % 2 !== 0) continue;
      let nearH = false;
      for (const h of state.roadH) {
        if (Math.abs(y - h) < 80) { nearH = true; break; }
      }
      if (nearH) continue;
      const side = (vi + k) % 2 === 0 ? 1 : -1;
      drawTree(ctx, v + side * 32, y, 11, TREES[(vi + k) % TREES.length]);
    }
  }
  for (let hi = 0; hi < state.roadH.length; hi++) {
    const h = state.roadH[hi];
    let k = 0;
    for (let x = 200; x < WORLD.width - 160; x += 280, k++) {
      if (k % 2 !== 0) continue;
      let nearV = false;
      for (const v of state.roadV) {
        if (Math.abs(x - v) < 80) { nearV = true; break; }
      }
      if (nearV) continue;
      const side = (hi + k) % 2 === 0 ? 1 : -1;
      drawTree(ctx, x, h + side * 32, 11, TREES[(hi + k + 1) % TREES.length]);
    }
  }
}

// Small bushes near some buildings, on the sidewalk below the block.
function drawBushes(ctx, buildings) {
  for (let i = 0; i < buildings.length; i++) {
    if (i % 3 !== 0) continue;
    const b = buildings[i];
    if (b.w < 40 || b.h < 40) continue;
    const bx = b.x + b.w * 0.25;
    const by = b.y + b.h + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.arc(bx + 1, by + 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = BUSH_GREENS[i % BUSH_GREENS.length];
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBeach(ctx, beach) {
  const { sandTop, seaTop } = beach;
  const H = WORLD.height;
  // Sand base.
  ctx.fillStyle = COLORS.sand;
  ctx.fillRect(0, sandTop, WORLD.width, seaTop - sandTop);
  // Dry upper sand (lighter).
  ctx.fillStyle = COLORS.sandLight;
  ctx.fillRect(0, sandTop, WORLD.width, 14);
  // A slightly darker mid band for a second sand tone.
  ctx.fillStyle = shade(COLORS.sand, -0.06);
  ctx.fillRect(0, sandTop + 26, WORLD.width, (seaTop - sandTop) - 40);
  // Wet sand near the waterline (light).
  ctx.fillStyle = COLORS.sandLight;
  ctx.fillRect(0, seaTop - 12, WORLD.width, 12);
  // Subtle dune strokes.
  ctx.strokeStyle = 'rgba(120,86,40,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < WORLD.width; x += 120) {
    ctx.moveTo(x, sandTop + 40);
    ctx.lineTo(x + 70, sandTop + 40);
  }
  ctx.stroke();
  // Sea base.
  ctx.fillStyle = COLORS.sea;
  ctx.fillRect(0, seaTop, WORLD.width, H - seaTop);
  // Subtle horizontal banding for water depth.
  for (let k = 1; k <= 3; k++) {
    ctx.fillStyle = shade(COLORS.sea, k % 2 === 0 ? 0.07 : -0.05);
    ctx.fillRect(0, seaTop + k * 24, WORLD.width, 10);
  }
  // Deep water toward the bottom.
  ctx.fillStyle = COLORS.seaDeep;
  ctx.fillRect(0, seaTop + 78, WORLD.width, H - seaTop - 78);
  // Foam / shoreline highlight at the waterline.
  ctx.fillStyle = COLORS.seaFoam;
  ctx.fillRect(0, seaTop, WORLD.width, 5);
  // A few wave strokes.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < WORLD.width; x += 80) {
    ctx.moveTo(x, seaTop + 24);
    ctx.lineTo(x + 60, seaTop + 24);
  }
  ctx.stroke();
}

function drawMarkers(ctx, state) {
  if (state.packageMarker) {
    glowCircle(ctx, state.packageMarker.x, state.packageMarker.y, 12, GOLD);
    label(ctx, 'PACKAGE', state.packageMarker.x, state.packageMarker.y + 24, GOLD);
  }
  if (state.safehouseMarker) {
    glowCircle(ctx, state.safehouseMarker.x, state.safehouseMarker.y, 12, GREEN);
    label(ctx, 'SAFEHOUSE', state.safehouseMarker.x, state.safehouseMarker.y + 24, GREEN);
  }
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

function drawCar(ctx, car, isPlayer, isPolice) {
  const L = CAR.length;
  const W = CAR.width;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Ground shadow so the car does not float on the asphalt.
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.beginPath();
  ctx.ellipse(1.5, 3, L * 0.52, W * 0.60, 0, 0, Math.PI * 2);
  ctx.fill();
  const body = isPolice ? '#1b2a4a' : (isPlayer ? MAGENTA : car.color);
  roundRect(ctx, -L / 2, -W / 2, L, W, 7);
  ctx.fillStyle = body;
  ctx.fill();
  if (isPlayer) {
    // Bright magenta with a thin light outline so it is easy to spot.
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
  } else {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  }
  ctx.stroke();
  // Windshield near the front (+x).
  ctx.fillStyle = 'rgba(180,220,235,0.55)';
  ctx.fillRect(L * 0.10, -W * 0.30, L * 0.16, W * 0.60);
  // Rear window hint, so parked cars read as cars from either end.
  ctx.fillStyle = 'rgba(150,190,205,0.45)';
  ctx.fillRect(-L * 0.38, -W * 0.26, L * 0.10, W * 0.52);
  // Roof panel in the middle — lightened so it reads clearly on every car.
  ctx.fillStyle = isPolice
    ? '#4a5a80'
    : (isPlayer ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.16)');
  roundRect(ctx, -L * 0.16, -W * 0.38, L * 0.26, W * 0.76, 4);
  ctx.fill();
  if (isPolice) {
    // Red-blue light bar across the roof.
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(-L * 0.02, -W * 0.36, L * 0.10, W * 0.28);
    ctx.fillStyle = '#4466ff';
    ctx.fillRect(-L * 0.02, W * 0.08, L * 0.10, W * 0.28);
  }
  ctx.restore();
}

function drawPeds(ctx, peds) {
  for (const p of peds) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.fallen) {
      // Lying flat: a small ellipse on the ground.
      ctx.rotate(p.angle);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Small shadow dot underneath so the ped does not float on the road.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(1, 3, 6, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
      // Direction tick.
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(p.angle) * 10, Math.sin(p.angle) * 10);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawPoliceFoot(ctx, u) {
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.fillStyle = '#2b3a8f';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(u.angle) * 11, Math.sin(u.angle) * 11);
  ctx.stroke();
  ctx.restore();
}

function drawPolice(ctx, police) {
  for (const u of police) {
    if (u.kind === 'car') drawCar(ctx, u, false, true);
    else drawPoliceFoot(ctx, u);
  }
}

function drawPlayer(ctx, player) {
  if (!player.onFoot) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = MAGENTA;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER.radius, 0, Math.PI * 2);
  ctx.stroke();
  // Direction tick.
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(player.angle) * (PLAYER.radius + 4), Math.sin(player.angle) * (PLAYER.radius + 4));
  ctx.stroke();
  ctx.restore();
}

function drawWorld(ctx, state) {
  // Ground beneath everything.
  ctx.fillStyle = COLORS.sidewalk;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  drawPark(ctx, state.park);
  drawPlaza(ctx, state.plaza);
  drawRoads(ctx, state);
  drawBuildings(ctx, state.buildings);
  drawStreetTrees(ctx, state);
  drawBushes(ctx, state.buildings);
  drawBeach(ctx, state.beach);
  drawMarkers(ctx, state);

  drawCars(ctx, state.cars);
  drawPeds(ctx, state.peds);
  drawPolice(ctx, state.police);
  drawPlayer(ctx, state.player);
}

function drawCars(ctx, cars) {
  for (const c of cars) drawCar(ctx, c, c.controlled === true, false);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function drawStars(ctx, wanted, rightX, cy) {
  const r = 11;
  for (let i = 0; i < 5; i++) {
    const cx = rightX - i * 26;
    starPath(ctx, cx, cy, 5, r, r * 0.45);
    if (i < wanted) {
      ctx.fillStyle = GOLD;
      ctx.fill();
    }
    ctx.strokeStyle = i < wanted ? GOLD : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawHud(ctx, state, viewW) {
  const pad = 14;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Money (top-left).
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = GOLD;
  ctx.fillText('$' + fmtMoney(state.money), pad, 26);

  // Health bar.
  const hb = { x: pad, y: 38, w: 200, h: 14 };
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(hb.x - 2, hb.y - 2, hb.w + 4, hb.h + 4);
  const hp = clamp(state.player.health / PLAYER.maxHealth, 0, 1);
  ctx.fillStyle = `hsl(${Math.round(hp * 120)}, 70%, 45%)`;
  ctx.fillRect(hb.x, hb.y, hb.w * hp, hb.h);

  // Current mission objective text.
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = '#ffffff';
  const m = state.mission;
  if (m) {
    ctx.fillText((m.title ? m.title + ': ' : '') + (m.objective || m.text || ''), pad, 78);
  } else {
    ctx.fillText('All missions complete!', pad, 78);
  }

  // Speed in km/h.
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = '#e8e8e8';
  if (state.player.onFoot) {
    ctx.fillText('on foot', pad, 102);
  } else {
    const kmh = Math.round(Math.abs(state.player.car.speed) * 0.25);
    ctx.fillText(kmh + ' km/h', pad, 102);
  }

  // Wanted stars (top-right).
  drawStars(ctx, state.wanted, viewW - pad - 4, 22);
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------

function missionTarget(state) {
  const m = state.mission;
  if (!m) return null;
  if (m.id === 'safehouse-drop') return state.safehouseMarker;
  if (m.id === 'the-package') return state.packageMarker;
  return null;
}

function drawMinimap(ctx, state, viewW, viewH) {
  const mw = 190, mh = 95, margin = 10;
  const mx = margin;
  const my = viewH - mh - margin;

  ctx.fillStyle = 'rgba(10,14,22,0.75)';
  ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx - 3, my - 3, mw + 6, mh + 6);

  const sx = mw / WORLD.width;
  const sy = mh / WORLD.height;
  const px = (x) => mx + x * sx;
  const py = (y) => my + y * sy;

  // Roads.
  ctx.strokeStyle = 'rgba(200,200,200,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const v of state.roadV) { ctx.moveTo(px(v), my); ctx.lineTo(px(v), my + mh); }
  for (const h of state.roadH) { ctx.moveTo(mx, py(h)); ctx.lineTo(mx + mw, py(h)); }
  ctx.stroke();

  // Mission marker (yellow dot).
  const target = missionTarget(state);
  if (target) {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(px(target.x), py(target.y), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Police (red dots).
  ctx.fillStyle = '#ff3b3b';
  for (const u of state.police) {
    ctx.beginPath();
    ctx.arc(px(u.x), py(u.y), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player (white dot).
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px(state.player.x), py(state.player.y), 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function drawScene(ctx, state, viewW, viewH) {
  const cam = cameraFor(state, viewW, viewH);
  ctx.save();
  ctx.translate(-cam.cx, -cam.cy);
  drawWorld(ctx, state);
  ctx.restore();
  return cam;
}

function drawTitle(ctx, viewW, viewH, best) {
  ctx.fillStyle = '#10131c';
  ctx.fillRect(0, 0, viewW, viewH);
  const cx = viewW / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = 'bold 64px sans-serif';
  ctx.fillStyle = GOLD;
  ctx.fillText('Solmar City', cx, viewH * 0.34);

  ctx.font = '22px sans-serif';
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('Press Enter to start', cx, viewH * 0.46);

  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#9aa0aa';
  const lines = [
    'Move: Arrow keys / WASD',
    'Enter / exit car: E',
    'Action (knock down peds): F',
    'Pause: P',
  ];
  let ly = viewH * 0.58;
  for (const l of lines) { ctx.fillText(l, cx, ly); ly += 24; }

  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = GOLD;
  ctx.fillText('Best: $' + fmtMoney(best), cx, ly + 10);
}

function overlayPanel(ctx, text, sub, viewW, viewH) {
  ctx.fillStyle = 'rgba(8,10,16,0.6)';
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, viewW / 2, viewH / 2 - 10);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#cccccc';
  ctx.fillText(sub, viewW / 2, viewH / 2 + 24);
}

function drawGameOverOverlay(ctx, state, viewW, viewH, best) {
  ctx.fillStyle = 'rgba(8,10,16,0.72)';
  ctx.fillRect(0, 0, viewW, viewH);
  const cx = viewW / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = 'bold 54px sans-serif';
  ctx.fillStyle = state.busted ? '#ff5555' : GOLD;
  ctx.fillText(state.busted ? 'BUSTED' : 'GAME OVER', cx, viewH * 0.36);

  ctx.font = '24px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Final money: $' + fmtMoney(state.money), cx, viewH * 0.5);
  ctx.fillStyle = GOLD;
  ctx.fillText('Best: $' + fmtMoney(best), cx, viewH * 0.56);

  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('Press Enter to play again', cx, viewH * 0.68);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  // Size the backing store to the visible window before anything is drawn.
  // The page CSS stretches the canvas element to fill the whole viewport, but
  // a bare <canvas> keeps its 300x150 internal pixel size — so without this,
  // the browser scales a small drawing up ~4x: the minimap balloons over the
  // mission text and the speed readout, and every HUD label renders far too
  // large. Set canvas.width/height to the real viewport size (times the device
  // pixel ratio for crisp HiDPI output) and re-run it on every window resize.
  // Sizing touches no drawing state, so determinism is untouched: the same world
  // state still draws pixel-identically frame to frame.
  function fitCanvas() {
    let w;
    let h;
    let dpr = 1;
    if (typeof window !== 'undefined' && window.innerWidth) {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = window.devicePixelRatio || 1;
    } else {
      // No window (Node, tests): fall back to the element's own box, then to a
      // sensible default.
      w = canvas.clientWidth || 1280;
      h = canvas.clientHeight || 720;
    }
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  }

  fitCanvas();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', fitCanvas);
  }

  const viewW = () => canvas.width || 800;
  const viewH = () => canvas.height || 600;

  function draw(state, screen, best) {
    const vw = viewW();
    const vh = viewH();
    ctx.clearRect(0, 0, vw, vh);

    if (screen === SCREEN_TITLE) {
      drawTitle(ctx, vw, vh, best);
      return null;
    }

    if (screen === SCREEN_PAUSED) {
      drawScene(ctx, state, vw, vh);
      drawHud(ctx, state, vw);
      overlayPanel(ctx, 'Paused', 'Press P to resume', vw, vh);
      return null;
    }

    if (screen === SCREEN_OVER) {
      drawScene(ctx, state, vw, vh);
      drawGameOverOverlay(ctx, state, vw, vh, best);
      return null;
    }

    // Default: the play screen (world + HUD + minimap).
    const cam = drawScene(ctx, state, vw, vh);
    drawHud(ctx, state, vw);
    drawMinimap(ctx, state, vw, vh);
    return cam;
  }

  return { draw };
}

// Solmar City — boot and game loop.
// Ties the other modules together: a fixed-timestep simulation driven by
// requestAnimationFrame, a screen state machine (title / play / paused / over),
// sound cues driven by the world state, best-money persistence, and a
// screenshot mode that stages a single deterministic scene for the tooling.

import { STEP, BEST_KEY } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_OVER, EVENT_BUSTED, EVENT_MISSION } from './world.js';
import {
  createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED, SCREEN_OVER,
} from './render.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE } from './input.js';
import { createSound } from './sound.js';
import { stageShot } from './shots.js';

// Fixed seed for normal play: every session opens the same city. Screenshot
// scenes pass their own seed and never touch this one.
const SEED = 1337;

// Clamp the per-frame wall-clock gap so a stalled tab (or a debugger pause)
// cannot fast-forward the simulation in one giant catch-up (spiral of death).
const MAX_FRAME_SECONDS = 0.25;

// Live handles, module-scoped so the loop and the test hook can both reach
// them. `world` stays null in screenshot mode (no simulation is built there).
let world = null;
let screen = SCREEN_TITLE;

// ------------------------------------------------------------- persistence --
// Best money lives in localStorage under BEST_KEY so it survives reloads.
// Both helpers tolerate localStorage being unavailable (private mode, Node).

function loadBest() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(BEST_KEY);
    if (raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (err) {
    return 0;
  }
}

function saveBest(value) {
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(BEST_KEY, String(value));
    }
  } catch (err) {
    // localStorage unavailable — ignore
  }
}

// ------------------------------------------------------------------ helpers --

function countFallen(peds) {
  let n = 0;
  for (const p of peds) if (p.fallen) n += 1;
  return n;
}

// The ?shot=<name>&seed=<n> query pair that switches the page into screenshot
// mode. Returns null when either parameter is missing.
function readShotParams() {
  const search = (typeof globalThis.location !== 'undefined' && globalThis.location.search) || '';
  const params = new URLSearchParams(search);
  const shot = params.get('shot');
  const seed = params.get('seed');
  if (shot == null || seed == null) return null;
  return { shot, seed: Number(seed) };
}

// --------------------------------------------------------------------- boot --

function boot() {
  const canvas = document.getElementById('game');
  const renderer = createRenderer(canvas);
  const input = createInput(canvas);
  const sound = createSound();

  // Screenshot mode: stage one deterministic scene, paint it exactly once and
  // signal readiness. The normal game loop never runs here — the screenshot
  // tool only needs a single painted frame.
  const shot = readShotParams();
  if (shot) {
    const staged = stageShot(shot.shot, shot.seed);
    renderer.draw(staged.state, staged.screen, loadBest());
    if (typeof window !== 'undefined') window.__shotReady = true;
    globalThis.__shotReady = true;
    return;
  }

  // Normal play: a fresh seeded world, starting on the title screen.
  world = createWorld(createRandom(SEED));
  screen = SCREEN_TITLE;
  let best = loadBest();
  let acc = 0;         // leftover wall-clock seconds not yet simulated
  let lastTime = null; // timestamp (ms) of the previous frame

  function frame(now) {
    // Delta time in seconds, clamped to a sane maximum. Time is measured in
    // seconds, never milliseconds — the simulation advances in STEP (1/60 s).
    if (lastTime == null) lastTime = now;
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > MAX_FRAME_SECONDS) dt = MAX_FRAME_SECONDS;
    if (dt < 0) dt = 0;

    // One-shot actions (edge-triggered), consumed once per frame.
    const actions = input.consume();

    if (screen === SCREEN_TITLE) {
      if (actions[ACTION_CONFIRM]) {
        sound.blip();
        screen = SCREEN_PLAY;
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions[ACTION_PAUSE]) {
        sound.blip();
        screen = SCREEN_PLAY;
      }
    } else if (screen === SCREEN_OVER) {
      if (actions[ACTION_CONFIRM]) {
        sound.blip();
        world.reset(); // fresh run from the same seed
        screen = SCREEN_PLAY;
        acc = 0;
      }
    } else if (screen === SCREEN_PLAY) {
      if (actions[ACTION_PAUSE]) {
        sound.blip();
        screen = SCREEN_PAUSED;
      } else {
        // Advance the simulation in exact STEP increments so the world runs at
        // the same rate no matter the display refresh.
        acc += dt;
        while (acc >= STEP) {
          acc -= STEP;
          const beforeHealth = world.state.player.health;
          const beforeFallen = countFallen(world.state.peds);
          const event = world.step(STEP, input.read());

          // Sound cues from what the world reported / what changed this step.
          if (event === EVENT_MISSION) {
            // A mission just completed. No next mission means the whole chain
            // is done (completion jingle); otherwise we are progressing to the
            // next mission (progress blip). Read the state to tell them apart.
            if (world.state.mission === null) sound.jingle();
            else sound.blip();
          }
          if (world.state.player.health < beforeHealth - 1e-6 ||
              countFallen(world.state.peds) > beforeFallen) {
            sound.thud(); // a police unit rammed us, or we knocked a ped over
          }

          if (event === EVENT_OVER || event === EVENT_BUSTED) {
            screen = SCREEN_OVER;
            break;
          }
        }

        // Track the best-money record while playing.
        if (world.state.money > best) {
          best = world.state.money;
          saveBest(best);
        }
      }
    }

    // Engine hum follows the car speed while driving and is silent on foot or
    // whenever the simulation is frozen (title / pause / game over). The siren
    // sounds while the wanted level is above zero.
    const player = world.state.player;
    const live = screen === SCREEN_PLAY;
    sound.engine(live && !player.onFoot && player.car ? Math.abs(player.car.speed) : 0);
    sound.siren(live && world.state.wanted > 0);

    renderer.draw(world.state, screen, best);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot();

// Test / debug hook: the live world state, or null in screenshot mode where no
// simulation is built. Not part of the game's public behaviour.
export function getWorldState() {
  return world ? world.state : null;
}

// Solmar City — main entry.
// Boots the game in the browser, runs a fixed-timestep loop, drives the
// screens (title / play / paused / game-over), wires up the sound cues,
// tracks the best money in localStorage, and supports shot mode for staging
// screenshots without a running loop.
//
// Written from scratch for the make.fun gta6-01 bounty.

import { createRandom } from './random.js';
import { createWorld } from './world.js';
import {
  createRenderer,
  SCREEN_TITLE,
  SCREEN_PLAY,
  SCREEN_PAUSED,
  SCREEN_OVER,
} from './render.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE } from './input.js';
import { createSound } from './sound.js';
import { stageShot } from './shots.js';
import { STEP, BEST_KEY } from './config.js';

// Largest amount of real time (seconds) we will simulate in a single frame.
// Guards against a spiral of death after the tab is backgrounded or stalls.
const MAX_FRAME_SECONDS = 0.25;

// Every new game (and the initial boot world) starts from this seed.
const INITIAL_SEED = 1;

function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    throw new Error('Solmar City: canvas #game not found');
  }

  const renderer = createRenderer(canvas);
  const input = createInput(canvas);
  const sound = createSound();

  let random = createRandom(INITIAL_SEED);
  let world = createWorld(random);
  let screen = SCREEN_TITLE;

  // Best money: read once at boot, ignore any storage problem.
  let best = 0;
  try {
    const stored = localStorage.getItem(BEST_KEY);
    const parsed = stored == null ? 0 : Number(stored);
    best = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch (err) {
    best = 0;
  }

  // Previous-frame values used to detect changes for the sound cues.
  let prevWanted = 0;
  let prevMission = null;
  let prevMoney = 0;
  let prevHealth = 0;
  let stopSiren = null;

  let acc = 0;
  let last = performance.now();

  // Reset the previous-frame trackers to the current state so a fresh game
  // (or the initial boot) does not fire spurious sound cues.
  function syncPrev() {
    const s = world.state;
    prevWanted = s.wanted;
    prevMission = s.mission;
    prevMoney = s.money;
    prevHealth = s.player.health;
    if (stopSiren) {
      stopSiren();
      stopSiren = null;
    }
  }

  // Player speed as a number in [0, 1] for the engine sound: the car's speed
  // while driving, 0 on foot or when there is no car / no speed.
  function playerSpeed() {
    const p = world.state.player;
    if (p.onFoot) return 0;
    const car = p.car;
    if (!car) return 0;
    const v = car.speed;
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') return Math.hypot(v.x || 0, v.y || 0);
    return 0;
  }

  function updateSoundAndBest() {
    const s = world.state;

    sound.engine(Math.max(0, Math.min(1, playerSpeed())));

    // Siren: start when wanted climbs to 1+, stop when it returns to 0.
    if (prevWanted < 1 && s.wanted >= 1) {
      if (!stopSiren) stopSiren = sound.siren();
    } else if (s.wanted < 1 && stopSiren) {
      stopSiren();
      stopSiren = null;
    }

    if (s.mission !== prevMission) sound.blip();
    if (s.money > prevMoney) sound.jingle();
    if (s.player.health < prevHealth) sound.thud();

    prevWanted = s.wanted;
    prevMission = s.mission;
    prevMoney = s.money;
    prevHealth = s.player.health;

    if (s.money > best) {
      best = s.money;
      try {
        localStorage.setItem(BEST_KEY, String(best));
      } catch (err) {
        // Storage unavailable: ignore silently.
      }
    }
  }

  function startNewGame() {
    random = createRandom(INITIAL_SEED);
    world = createWorld(random);
    screen = SCREEN_PLAY;
    acc = 0;
    syncPrev();
  }

  function handleTransitions() {
    if (screen === SCREEN_TITLE) {
      if (input.consume(ACTION_CONFIRM)) startNewGame();
    } else if (screen === SCREEN_PLAY) {
      if (input.consume(ACTION_PAUSE)) screen = SCREEN_PAUSED;
    } else if (screen === SCREEN_PAUSED) {
      if (input.consume(ACTION_PAUSE)) screen = SCREEN_PLAY;
    } else if (screen === SCREEN_OVER) {
      if (input.consume(ACTION_CONFIRM)) startNewGame();
    }
  }

  function frame(now) {
    const elapsed = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
    last = now;
    acc += elapsed;

    handleTransitions();

    if (screen === SCREEN_PLAY) {
      // Fixed timestep: step the world once per STEP with the current input.
      while (acc >= STEP) {
        world.step(STEP, input.read());
        acc -= STEP;
      }
      if (world.state.over || world.state.busted) {
        screen = SCREEN_OVER;
      }
    } else {
      // Not playing: don't advance the simulation, just redraw the screen.
      acc = 0;
    }

    updateSoundAndBest();
    renderer.draw(world.state, screen, best);
    requestAnimationFrame(frame);
  }

  function runShotMode(params) {
    const scene = params.get('shot') || 'cover';
    const rawSeed = params.get('seed');
    const seed = rawSeed == null || rawSeed === '' ? INITIAL_SEED : Number(rawSeed);
    const shot = stageShot(scene, Number.isFinite(seed) ? seed : INITIAL_SEED);
    // Draw the inner staged state, not the whole shot object.
    renderer.draw(shot.state, SCREEN_PLAY, best);
    window.__shotReady = true;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has('shot')) {
    // Shot mode: no loop, no input, no animation — just stage one frame.
    runShotMode(params);
    return;
  }

  requestAnimationFrame(frame);
}

// Boot only in a browser environment. In Node (used for import verification)
// the module loads without touching any browser globals.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

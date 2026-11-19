// Solmar City — keyboard + mouse input.
//
// Tracks held keys for movement (arrow keys + WASD, live) and latches
// edge-triggered actions (enter / action / pause). Edge actions stay true
// once seen until consume() clears them, so a single key press or canvas
// tap is reported exactly once. No build step, no dependencies.

import { KEYS } from './config.js';

// Action tags exported for callers that want to label an action.
export const ACTION_CONFIRM = 'confirm';
export const ACTION_PAUSE = 'pause';

export function createInput(canvas) {
  const held = new Set();
  let confirmEdge = false;
  let actionEdge = false;
  let pauseEdge = false;

  const root = globalThis;

  const isArrow = (code) =>
    code === KEYS.up || code === KEYS.down ||
    code === KEYS.left || code === KEYS.right;

  const isScrollKey = (code) => isArrow(code) || code === 'Space';

  const onKeyDown = (e) => {
    // Keep arrow keys / space from scrolling the page while playing.
    if (isScrollKey(e.code)) e.preventDefault();
    if (e.repeat) return; // auto-repeat must not re-trigger an edge
    held.add(e.code);
    if (e.code === KEYS.enterCar || e.code === 'Enter' || e.code === 'NumpadEnter') {
      confirmEdge = true;
    }
    if (e.code === KEYS.action) actionEdge = true;
    if (e.code === KEYS.pause) pauseEdge = true;
  };

  const onKeyUp = (e) => {
    held.delete(e.code);
  };

  const onBlur = () => {
    held.clear();
  };

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('blur', onBlur);
  }

  // A click or tap on the game canvas counts as a confirm.
  if (canvas && typeof canvas.addEventListener === 'function') {
    const onPrimary = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      confirmEdge = true;
    };
    canvas.addEventListener('pointerdown', onPrimary);
    canvas.addEventListener('click', onPrimary);
  }

  return {
    read() {
      return {
        up: held.has(KEYS.up) || held.has('KeyW'),
        down: held.has(KEYS.down) || held.has('KeyS'),
        left: held.has(KEYS.left) || held.has('KeyA'),
        right: held.has(KEYS.right) || held.has('KeyD'),
        enter: confirmEdge,
        action: actionEdge,
        pause: pauseEdge,
      };
    },
    consume() {
      confirmEdge = false;
      actionEdge = false;
      pauseEdge = false;
    },
  };
}

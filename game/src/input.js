// Solmar City — keyboard input.
// Reads held keys for continuous movement (read) and one-shot actions
// (consume) for confirm / pause / enter. Purely window-event driven, no deps.

// Named action constants. The game loop reads them off the object returned by
// consume(): e.g. consume()[ACTION_CONFIRM] is true when Enter went down.
export const ACTION_CONFIRM = 'confirm';
export const ACTION_PAUSE = 'pause';

// Each logical action maps to one or more physical key codes.
const ACTION_KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  enter: ['KeyE'],
  action: ['KeyF'],
  pause: ['KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
};

// Keys whose default browser behaviour (page scroll) must be suppressed.
const PREVENT_DEFAULT = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

export function createInput(canvas) {
  // Key codes physically held right now (true while the key is down).
  const held = new Set();
  // Key codes that went down since the last consume() (one-shot edge).
  const pressed = new Set();

  const onKeyDown = (event) => {
    if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
    if (event.repeat) return; // a held key only counts once for consume()
    held.add(event.code);
    pressed.add(event.code);
  };

  const onKeyUp = (event) => {
    if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
    held.delete(event.code);
  };

  const onBlur = () => {
    // Losing focus means no key is held any more. One-shot edges are kept so
    // a press that happened right before the blur is still reported once.
    held.clear();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const isHeld = (codes) => codes.some((code) => held.has(code));
  const wasPressed = (codes) => codes.some((code) => pressed.has(code));

  const read = () => ({
    up: isHeld(ACTION_KEYS.up),
    down: isHeld(ACTION_KEYS.down),
    left: isHeld(ACTION_KEYS.left),
    right: isHeld(ACTION_KEYS.right),
    enter: isHeld(ACTION_KEYS.enter),
    action: isHeld(ACTION_KEYS.action),
    pause: isHeld(ACTION_KEYS.pause),
  });

  // Returns and clears the one-shot action set. Same field names as read(),
  // plus a "confirm" field for the Enter key. Each field is true only if that
  // key went down since the previous consume() call.
  const consume = () => {
    const result = {
      up: wasPressed(ACTION_KEYS.up),
      down: wasPressed(ACTION_KEYS.down),
      left: wasPressed(ACTION_KEYS.left),
      right: wasPressed(ACTION_KEYS.right),
      enter: wasPressed(ACTION_KEYS.enter),
      action: wasPressed(ACTION_KEYS.action),
      pause: wasPressed(ACTION_KEYS.pause),
      confirm: wasPressed(ACTION_KEYS.confirm),
    };
    pressed.clear();
    return result;
  };

  return { read, consume };
}

// Reads and consumes keyboard input for the game.

// Seeded PRNG (mulberry32) for deterministic Solmar City simulation.

/**
 * Create a deterministic random number generator.
 * @param {number} seed any numeric seed; same seed -> same sequence
 * @returns {{next: () => number, int: (min:number, max:number) => number,
 *            pick: <T>(arr: T[]) => T, range: (a:number, b:number) => number}}
 */
export function createRandom(seed) {
  let a = seed >>> 0;

  // mulberry32 core
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min, max) {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function pick(arr) {
    return arr[Math.floor(next() * arr.length)];
  }

  function range(a, b) {
    return next() * (b - a) + a;
  }

  return { next, int, pick, range };
}
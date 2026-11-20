// Deterministic seeded PRNG (mulberry32). Same seed, same sequence, always.
// No Math.random, no Date, no imports — purely arithmetic on the seed.
export function createRandom(seed) {
  let a = seed >>> 0;

  // Next float in [0, 1).
  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Integer in [min, max] inclusive.
  function int(min, max) {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  // One element chosen from an array.
  function pick(array) {
    return array[Math.floor(next() * array.length)];
  }

  // Float in [low, high).
  function range(low, high) {
    return next() * (high - low) + low;
  }

  return { next, int, pick, range };
}

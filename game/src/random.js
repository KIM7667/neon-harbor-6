// random.js - a small seeded random number generator (mulberry32) plus helpers.
// The whole city is placed from one seed, so the same seed always builds the same
// Neon Harbor: same buildings, same parked cars, same crowds. Nothing in the game
// calls Math.random for world placement.

export function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random float in [min, max). */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** Random integer in [min, max], both ends included. */
export function intRange(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One element of the array, chosen by the seeded rng. */
export function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}

/** True with probability p. */
export function chance(rng, p) {
  return rng() < p;
}

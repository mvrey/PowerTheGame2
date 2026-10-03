import { Rng } from './bot';

/** Mulberry32: small, fast, seedable. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed from the clock and Math.random, for games that need not be replayed. */
export const randomSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

/** The random numbers of one seat of a game: every seat gets its own stream from the game's seed. */
export function seatRng(seed: number, player: number): Rng {
  // Two primes keep the streams of neighbouring seeds and seats apart.
  return makeRng(seed * 7919 + player * 104729);
}

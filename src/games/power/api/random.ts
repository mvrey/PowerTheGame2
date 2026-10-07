import { makeRng } from '../../../platform/core/random';
import { Rng } from './bot';

export { makeRng, randomSeed } from '../../../platform/core/random';

/** The random numbers of one seat of a game: every seat gets its own stream from the game's seed. */
export function seatRng(seed: number, player: number): Rng {
  // Two primes keep the streams of neighbouring seeds and seats apart.
  return makeRng(seed * 7919 + player * 104729);
}

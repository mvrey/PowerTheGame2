/** Random numbers in [0, 1). */
export type Rng = () => number;

/**
 * One step of Mulberry32 from a 32-bit state: the number in [0, 1) and the next state. For
 * games that keep their dice in the (serialisable) game state.
 */
export function rngStep(state: number): { value: number; state: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

/** Mulberry32: small, fast, seedable. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    const step = rngStep(a);
    a = step.state;
    return step.value;
  };
}

/** A fresh seed from the clock and Math.random, for matches that need not be replayed from their seed. */
export const randomSeed = (): number => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

/**
 * A 32-bit seed derived from a parent seed and a label, so that every match of a tournament gets
 * its own stream that does not depend on the order the matches are played in.
 */
export function deriveSeed(seed: number, label: string): number {
  return parseInt(fingerprintText(`${seed >>> 0}:${label}`).slice(0, 8), 16) >>> 0;
}

/**
 * The seed a seat's bot gets in `hello`: its own stream, derived from the match seed, so that it
 * says nothing about the game's chance (a game with dice draws them from the match seed).
 */
export const botSeed = (seed: number, seat: number): number => deriveSeed(seed, `bot:${seat}`);

/** Fisher–Yates on a copy. */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A 64-bit fingerprint of a text, as 16 hex digits (two independent 32-bit lanes of a
 * multiply-xorshift hash). Detects divergence between two runs; not meant to resist forgery,
 * which is why replays are verified by playing them again.
 */
export function fingerprintText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/** Fingerprint of a JSON value (key order as built, which is deterministic for a game state). */
export const fingerprint = (value: unknown): string => fingerprintText(JSON.stringify(value));

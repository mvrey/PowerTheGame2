import { Rng } from '../../api';

/** A random item, each with a chance proportional to its (non-negative) weight. */
export function pick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T | undefined {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return items[0];
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The item with the highest score, the first one on a tie. `score` returns null to rule an item
 * out; items are scored in order, so scores may draw random numbers.
 */
export function bestBy<T>(items: Iterable<T>, score: (item: T) => number | null): T | undefined {
  let best: { item: T; score: number } | undefined;
  for (const item of items) {
    const value = score(item);
    if (value !== null && (!best || value > best.score)) best = { item, score: value };
  }
  return best?.item;
}

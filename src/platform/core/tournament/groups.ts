import { Placement } from '../game';
import { deriveSeed, makeRng, shuffled } from '../random';
import { Fixture, FixtureResult, StandingRow, WorldCupConfig } from './types';

const GROUP_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Splits the entrants into groups at random (from the tournament seed), as evenly as possible.
 * Up to groupSize + 1 entrants make a single group.
 */
export function drawGroups(
  entrants: readonly string[],
  groupSize: number,
  seed: number,
): { name: string; entrants: string[] }[] {
  const order = shuffled(makeRng(deriveSeed(seed, 'draw')), entrants);
  const count = order.length <= groupSize + 1 ? 1 : Math.ceil(order.length / groupSize);
  const groups: { name: string; entrants: string[] }[] = [];
  let next = 0;
  for (let i = 0; i < count; i++) {
    const size = Math.floor(order.length / count) + (i < order.length % count ? 1 : 0);
    groups.push({ name: GROUP_NAMES[i], entrants: order.slice(next, next + size) });
    next += size;
  }
  return groups;
}

/**
 * A group's matches: every pair plays every duel variant twice, once from each seat; then, if the
 * game has a free-for-all for the group's size, one match per seat rotation, so that every bot
 * plays every seat against the same opponents.
 */
export function groupFixtures(
  group: { name: string; entrants: string[] },
  config: WorldCupConfig,
  seed: number,
): Fixture[] {
  const fixtures: Fixture[] = [];
  const { name, entrants } = group;
  let duel = 0;
  for (let i = 0; i < entrants.length; i++) {
    for (let j = i + 1; j < entrants.length; j++) {
      for (const variant of config.duel.variants) {
        for (const seats of [
          [entrants[i], entrants[j]],
          [entrants[j], entrants[i]],
        ]) {
          const id = `${name}-D${String(++duel).padStart(2, '0')}`;
          fixtures.push({
            id,
            stage: 'group',
            group: name,
            kind: 'duel',
            seats,
            setup: { format: config.duel.format, variant, maxTurns: config.duel.maxTurns, seed: deriveSeed(seed, id) },
            label: `Group ${name} · duel ${duel} · ${variant}`,
          });
        }
      }
    }
  }
  const ffa = config.ffa;
  const format = ffa?.formats[String(entrants.length)];
  if (ffa && format) {
    entrants.forEach((_, rotation) => {
      const id = `${name}-F${rotation + 1}`;
      const variant = ffa.variants[rotation % ffa.variants.length];
      fixtures.push({
        id,
        stage: 'group',
        group: name,
        kind: 'ffa',
        seats: [...entrants.slice(rotation), ...entrants.slice(0, rotation)],
        setup: { format, variant, maxTurns: ffa.maxTurns, seed: deriveSeed(seed, id) },
        label: `Group ${name} · free-for-all ${rotation + 1} · ${variant}`,
      });
    });
  }
  return fixtures;
}

/** How seat `seat` did in a two-seat match. */
export function duelOutcome(placements: Placement[], seat: number): 'win' | 'draw' | 'loss' {
  const mine = placements[seat].rank;
  const theirs = placements[1 - seat].rank;
  return mine < theirs ? 'win' : mine === theirs ? 'draw' : 'loss';
}

/** Free-for-all points: one per opponent finished strictly behind. */
export const ffaPoints = (placements: Placement[], seat: number): number =>
  placements.filter((p) => p.rank > placements[seat].rank).length;

/** A deterministic, published-in-advance coin toss: the last tiebreaker. */
export const lottery = (seed: number, id: string): number => deriveSeed(seed, `lottery:${id}`);

/**
 * A group's table: points (duels and free-for-all), then head-to-head duel points between the tied
 * bots, then duel material difference, then free-for-all points, then duel wins, then the lottery.
 */
export function groupStandings(
  entrants: readonly string[],
  fixtures: readonly Fixture[],
  results: ReadonlyMap<string, FixtureResult>,
  config: WorldCupConfig,
  seed: number,
): StandingRow[] {
  const rows = new Map(
    entrants.map((id) => [
      id,
      { id, played: 0, won: 0, drawn: 0, lost: 0, points: 0, duelPoints: 0, ffaPoints: 0, material: 0 },
    ]),
  );
  const duels: { seats: string[]; placements: Placement[] }[] = [];
  for (const fixture of fixtures) {
    const result = results.get(fixture.id);
    if (!result) continue;
    fixture.seats.forEach((id, seat) => {
      const row = rows.get(id)!;
      row.played++;
      if (fixture.kind === 'ffa') {
        row.ffaPoints += ffaPoints(result.placements, seat);
        return;
      }
      const outcome = duelOutcome(result.placements, seat);
      row[outcome === 'win' ? 'won' : outcome === 'draw' ? 'drawn' : 'lost']++;
      row.duelPoints += config.points[outcome];
      row.material += result.placements[seat].score - result.placements[1 - seat].score;
    });
    if (fixture.kind === 'duel') duels.push({ seats: fixture.seats, placements: result.placements });
  }
  for (const row of rows.values()) row.points = row.duelPoints + row.ffaPoints;

  const sorted = [...rows.values()].sort((a, b) => b.points - a.points);
  const ranked: StandingRow[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].points === sorted[start].points) end++;
    const tied = sorted.slice(start, end);
    const headToHead = miniLeague(new Set(tied.map((r) => r.id)), duels, config);
    tied.sort(
      (a, b) =>
        headToHead.get(b.id)! - headToHead.get(a.id)! ||
        b.material - a.material ||
        b.ffaPoints - a.ffaPoints ||
        b.won - a.won ||
        lottery(seed, a.id) - lottery(seed, b.id),
    );
    ranked.push(...tied);
    start = end;
  }
  return ranked;
}

/** Duel points earned only in duels between the given bots. */
function miniLeague(
  ids: Set<string>,
  duels: { seats: string[]; placements: Placement[] }[],
  config: WorldCupConfig,
): Map<string, number> {
  const points = new Map([...ids].map((id) => [id, 0]));
  for (const duel of duels) {
    if (!duel.seats.every((id) => ids.has(id))) continue;
    duel.seats.forEach((id, seat) =>
      points.set(id, points.get(id)! + config.points[duelOutcome(duel.placements, seat)]),
    );
  }
  return points;
}

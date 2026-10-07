import { deriveSeed } from '../random';
import { duelOutcome, lottery } from './groups';
import { Decision, Fixture, FixtureResult, GroupState, StandingRow, TieState, WorldCupConfig } from './types';

/** Bracket positions of seeds 1..size, so that the best seeds meet as late as possible: 1,8,4,5,2,7,3,6. */
export function bracketOrder(size: number): number[] {
  if (size === 1) return [1];
  return bracketOrder(size / 2).flatMap((seed) => [seed, size + 1 - seed]);
}

export const nextPowerOfTwo = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

export function roundName(size: number): string {
  return ({ 2: 'F', 4: 'SF', 8: 'QF' } as Record<number, string>)[size] ?? `R${size}`;
}

/**
 * Entrants ranked across groups at the same finishing place, for seeding and for the final
 * ranking. Groups may differ in size, so points and material count per match played.
 */
export function rankAcrossGroups(rows: readonly StandingRow[], seed: number): StandingRow[] {
  const per = (n: number, row: StandingRow) => (row.played ? n / row.played : 0);
  return [...rows].sort(
    (a, b) =>
      per(b.points, b) - per(a.points, a) ||
      per(b.material, b) - per(a.material, a) ||
      lottery(seed, a.id) - lottery(seed, b.id),
  );
}

/** The playoff seeds: every group winner first, then every runner-up, and so on. */
export function seedQualifiers(groups: readonly GroupState[], perGroup: number, seed: number): string[] {
  const seeds: string[] = [];
  for (let place = 0; place < perGroup; place++)
    seeds.push(
      ...rankAcrossGroups(
        groups.flatMap((g) => g.standings[place] ?? []),
        seed,
      ).map((r) => r.id),
    );
  return seeds;
}

/**
 * First-round pairs (null = bye, for the top seeds when the field is not a power of two). Where two
 * bots from the same group would meet at once, lower seeds are swapped between pairs if that helps.
 */
export function firstRound(
  seeds: readonly string[],
  groupOf: (id: string) => string | undefined,
): [string | null, string | null][] {
  const size = nextPowerOfTwo(seeds.length);
  const slot = (position: number) => seeds[position - 1] ?? null;
  const order = bracketOrder(size);
  const pairs: [string | null, string | null][] = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([slot(order[i]), slot(order[i + 1])]);
  const clash = ([a, b]: [string | null, string | null]) => a !== null && b !== null && groupOf(a) === groupOf(b);
  pairs.forEach((pair, i) => {
    if (!clash(pair)) return;
    const other = pairs.findIndex(
      (p, j) => j !== i && p[1] !== null && !clash([pair[0], p[1]]) && !clash([p[0], pair[1]]),
    );
    if (other >= 0) [pair[1], pairs[other][1]] = [pairs[other][1], pair[1]];
  });
  return pairs;
}

/**
 * The state of one playoff tie, and the matches it needs: every playoff variant twice with seats
 * swapped; if level on points and then material, sudden-death pairs one at a time; if still level,
 * the lottery.
 */
export function evaluateTie(
  id: string,
  round: string,
  a: string | null,
  b: string | null,
  firstRoundTie: boolean,
  config: WorldCupConfig,
  seed: number,
  results: ReadonlyMap<string, FixtureResult>,
): { tie: TieState; fixtures: Fixture[] } {
  const tie: TieState = {
    id,
    round,
    a,
    b,
    fixtures: [],
    score: [0, 0],
    material: [0, 0],
    winner: null,
    decidedBy: null,
  };
  if (a === null || b === null) {
    // In the first round a missing entrant is a bye; later it is a tie still to be decided.
    if (firstRoundTie && (a ?? b)) Object.assign(tie, { winner: a ?? b, decidedBy: 'bye' as Decision });
    return { tie, fixtures: [] };
  }
  const { playoff } = config;
  const game = (fixtureId: string, variant: string, seats: string[], what: string): Fixture => ({
    id: fixtureId,
    stage: 'playoff',
    tie: id,
    kind: 'duel',
    seats,
    setup: { format: config.duel.format, variant, maxTurns: playoff.maxTurns, seed: deriveSeed(seed, fixtureId) },
    label: `${round} ${id} · ${what} · ${variant}`,
  });
  const fixtures: Fixture[] = [];
  playoff.variants.forEach((variant, i) => {
    fixtures.push(game(`${id}-G${2 * i + 1}`, variant, [a, b], `game ${2 * i + 1}`));
    fixtures.push(game(`${id}-G${2 * i + 2}`, variant, [b, a], `game ${2 * i + 2}`));
  });

  /** Points and material of a set of games, from a's side; null while one is unplayed. */
  const tally = (games: Fixture[]) => {
    const score: [number, number] = [0, 0];
    const material: [number, number] = [0, 0];
    for (const g of games) {
      const result = results.get(g.id);
      if (!result) return null;
      const seatOfA = g.seats.indexOf(a);
      score[0] += config.points[duelOutcome(result.placements, seatOfA)];
      score[1] += config.points[duelOutcome(result.placements, 1 - seatOfA)];
      material[0] += result.placements[seatOfA].score;
      material[1] += result.placements[1 - seatOfA].score;
    }
    return { score, material };
  };
  const decide = (
    t: { score: [number, number]; material: [number, number] },
    byPoints: Decision,
    byMaterial: Decision,
  ) => {
    if (t.score[0] !== t.score[1]) return { winner: t.score[0] > t.score[1] ? a : b, decidedBy: byPoints };
    if (t.material[0] !== t.material[1])
      return { winner: t.material[0] > t.material[1] ? a : b, decidedBy: byMaterial };
    return null;
  };

  const main = tally(fixtures);
  if (main) {
    Object.assign(tie, main);
    let decision = decide(main, 'points', 'material');
    for (let pair = 1; !decision && pair <= playoff.suddenDeath; pair++) {
      const variant = playoff.variants[(pair - 1) % playoff.variants.length];
      const extra = [
        game(`${id}-SD${pair}A`, variant, [a, b], `sudden death ${pair}`),
        game(`${id}-SD${pair}B`, variant, [b, a], `sudden death ${pair}`),
      ];
      fixtures.push(...extra);
      const result = tally(extra);
      if (!result) break;
      decision = decide(result, 'sudden death', 'sudden death');
    }
    const suddenDeathOver = fixtures.every((f) => results.has(f.id));
    if (!decision && suddenDeathOver)
      decision = { winner: lottery(seed, `${id}:${a}`) < lottery(seed, `${id}:${b}`) ? a : b, decidedBy: 'lottery' };
    if (decision) Object.assign(tie, decision);
  }
  tie.fixtures = fixtures.map((f) => f.id);
  return { tie, fixtures };
}

export const loserOf = (tie: TieState): string | null =>
  tie.winner === null || tie.decidedBy === 'bye' ? null : tie.winner === tie.a ? tie.b : tie.a;

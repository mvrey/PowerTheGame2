import { describe, expect, it } from 'vitest';
import { Placement } from '../../src/platform/core/game';
import { drawGroups, groupFixtures, groupStandings } from '../../src/platform/core/tournament/groups';
import { planTournament } from '../../src/platform/core/tournament/plan';
import { bracketOrder, evaluateTie, firstRound } from '../../src/platform/core/tournament/playoff';
import { Fixture, FixtureResult, WorldCupConfig } from '../../src/platform/core/tournament/types';

const CONFIG: WorldCupConfig = {
  groupSize: 4,
  qualifiersPerGroup: 2,
  duel: { format: 'duel', variants: ['classic', 'ring'], maxTurns: 60 },
  ffa: { formats: { '3': 'ffa3', '4': 'ffa4' }, variants: ['classic'], maxTurns: 60 },
  playoff: { variants: ['classic'], maxTurns: 60, suddenDeath: 2, thirdPlace: true, exhibition: true },
  points: { win: 3, draw: 1, loss: 0 },
};
const SEED = 2026;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `bot${i + 1}`);

/** Results where the bot with the higher number in its id always wins (ties only between equals). */
function oracle(fixture: Fixture): FixtureResult {
  const strength = (id: string) => Number(id.replace(/\D/g, ''));
  const placements: Placement[] = fixture.seats.map((id) => ({
    rank: 1 + fixture.seats.filter((other) => strength(other) > strength(id)).length,
    score: strength(id) * 10,
  }));
  return { fixtureId: fixture.id, placements, replay: `${fixture.id}.json` };
}

const duelResult = (id: string, ranks: [number, number], scores: [number, number] = [50, 40]): FixtureResult => ({
  fixtureId: id,
  placements: [
    { rank: ranks[0], score: scores[0] },
    { rank: ranks[1], score: scores[1] },
  ],
  replay: '',
});

function playOut(n: number, config = CONFIG) {
  const entrants = ids(n).map((id) => ({ id, name: id }));
  const results: FixtureResult[] = [];
  for (let step = 0; step < 50; step++) {
    const plan = planTournament(config, entrants, SEED, results);
    if (plan.ranking) return { plan, results };
    expect(plan.pending.length, `stuck at step ${step}`).toBeGreaterThan(0);
    results.push(...plan.pending.map(oracle));
  }
  throw new Error('the tournament did not finish');
}

describe('the group draw', () => {
  it.each([2, 3, 5, 6, 7, 8, 9, 10, 13, 16])('%i bots: everyone once, groups of 3 to 5, even sizes', (n) => {
    const groups = drawGroups(ids(n), 4, SEED);
    expect(groups.flatMap((g) => g.entrants).sort()).toEqual(ids(n).sort());
    const sizes = groups.map((g) => g.entrants.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    if (n >= 6) expect(sizes.every((s) => s === 3 || s === 4)).toBe(true);
    else expect(groups).toHaveLength(1);
  });

  it('depends on the seed only', () => {
    expect(drawGroups(ids(10), 4, SEED)).toEqual(drawGroups(ids(10), 4, SEED));
    expect(drawGroups(ids(10), 4, SEED)).not.toEqual(drawGroups(ids(10), 4, SEED + 1));
  });
});

describe('group fixtures', () => {
  const fixtures = groupFixtures({ name: 'A', entrants: ids(4) }, CONFIG, SEED);
  const duels = fixtures.filter((f) => f.kind === 'duel');
  const ffa = fixtures.filter((f) => f.kind === 'ffa');

  it('every pair plays every duel map from both seats', () => {
    expect(duels).toHaveLength(6 * 2 * 2);
    for (const [a, b] of [
      ['bot1', 'bot2'],
      ['bot3', 'bot4'],
    ])
      for (const variant of CONFIG.duel.variants)
        for (const seats of [
          [a, b],
          [b, a],
        ])
          expect(duels.some((f) => f.setup.variant === variant && f.seats.join() === seats.join())).toBe(true);
  });

  it('the free-for-all set seats every bot in every seat once', () => {
    expect(ffa).toHaveLength(4);
    for (let seat = 0; seat < 4; seat++) expect(new Set(ffa.map((f) => f.seats[seat])).size).toBe(4);
    expect(ffa.every((f) => f.setup.format === 'ffa4')).toBe(true);
  });

  it('ids are unique and seeds differ', () => {
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map((f) => f.setup.seed)).size).toBe(fixtures.length);
  });
});

describe('group standings', () => {
  const entrants = ['a', 'b', 'c'];
  const config = { ...CONFIG, duel: { ...CONFIG.duel, variants: ['classic'] }, ffa: null };
  const fixtures = groupFixtures({ name: 'A', entrants }, config, SEED);
  const byPair = (x: string, y: string) => fixtures.filter((f) => f.seats.includes(x) && f.seats.includes(y));
  /** `winner` beats the other seat, scoring scores[0] against scores[1]. */
  const win = (f: Fixture, winner: string, scores: [number, number] = [50, 40]) =>
    f.seats[0] === winner ? duelResult(f.id, [1, 2], scores) : duelResult(f.id, [2, 1], [scores[1], scores[0]]);

  it('ranks by points, then head-to-head between the tied bots', () => {
    // a and b both beat c twice and split their own pair: level on points and head-to-head, so the
    // material decides, and a beat c by more.
    const [ab1, ab2] = byPair('a', 'b');
    const results = new Map<string, FixtureResult>([
      ...byPair('a', 'c').map((f) => [f.id, win(f, 'a', [90, 10])] as const),
      ...byPair('b', 'c').map((f) => [f.id, win(f, 'b', [60, 40])] as const),
      [ab1.id, win(ab1, 'a')],
      [ab2.id, win(ab2, 'b')],
    ]);
    const table = groupStandings(entrants, fixtures, results, config, SEED);
    expect(table.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(table[0]).toMatchObject({ points: 9, won: 3, lost: 1 });

    // If b wins both games against a instead, b is ahead on points.
    const flipped = new Map(results);
    flipped.set(ab1.id, win(ab1, 'b'));
    expect(groupStandings(entrants, fixtures, flipped, config, SEED)[0].id).toBe('b');
  });

  it('head-to-head beats material between bots level on points', () => {
    const four = ['a', 'b', 'c', 'd'];
    const own = groupFixtures({ name: 'A', entrants: four }, config, SEED);
    const games = (x: string, y: string) => own.filter((f) => f.seats.includes(x) && f.seats.includes(y));
    const draw = (f: Fixture) => duelResult(f.id, [1, 1], [40, 40]);
    const [ad1, ad2] = games('a', 'd');
    const [bd1, bd2] = games('b', 'd');
    // a and b end on 9 points each; a beat b twice, but b won its games by far more material.
    const results = new Map<string, FixtureResult>(
      [
        ...games('a', 'b').map((f) => win(f, 'a', [41, 40])),
        ...games('a', 'c').map((f) => win(f, 'c', [41, 40])),
        win(ad1, 'a', [41, 40]),
        win(ad2, 'd', [41, 40]),
        ...games('b', 'c').map((f) => win(f, 'b', [200, 0])),
        win(bd1, 'b', [200, 0]),
        win(bd2, 'd', [41, 40]),
        ...games('c', 'd').map(draw),
      ].map((r) => [r.fixtureId, r]),
    );
    const table = groupStandings(four, own, results, config, SEED);
    expect(table.slice(0, 2).map((r) => [r.id, r.points])).toEqual([
      ['a', 9],
      ['b', 9],
    ]);
    expect(table[1].material).toBeGreaterThan(table[0].material);
  });

  it('counts free-for-all points: one per opponent finished behind', () => {
    const ffaFixtures = groupFixtures({ name: 'A', entrants: ids(4) }, CONFIG, SEED).filter((f) => f.kind === 'ffa');
    const results = new Map(ffaFixtures.map((f) => [f.id, oracle(f)]));
    const table = groupStandings(ids(4), ffaFixtures, results, CONFIG, SEED);
    expect(table.map((r) => [r.id, r.ffaPoints])).toEqual([
      ['bot4', 12],
      ['bot3', 8],
      ['bot2', 4],
      ['bot1', 0],
    ]);
  });
});

describe('the playoff', () => {
  it('seeds the bracket so the best meet last', () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('gives byes to the top seeds and avoids same-group first-round meetings', () => {
    const seeds = ['A1', 'B1', 'C1', 'A2', 'B2', 'C2'];
    const pairs = firstRound(seeds, (id) => id[0]);
    expect(pairs).toHaveLength(4);
    expect(pairs.filter(([, b]) => b === null).map(([a]) => a)).toEqual(['A1', 'B1']);
    for (const [a, b] of pairs) if (a && b) expect(a[0]).not.toBe(b[0]);
  });

  const tie = (results: FixtureResult[]) =>
    evaluateTie('SF1', 'SF', 'x', 'y', false, CONFIG, SEED, new Map(results.map((r) => [r.fixtureId, r])));

  it('a series goes to the points, then the material', () => {
    expect(tie([duelResult('SF1-G1', [1, 2]), duelResult('SF1-G2', [1, 1])]).tie).toMatchObject({
      winner: 'x',
      decidedBy: 'points',
    });
    expect(tie([duelResult('SF1-G1', [1, 2], [50, 40]), duelResult('SF1-G2', [1, 2], [70, 30])]).tie).toMatchObject({
      winner: 'y',
      decidedBy: 'material',
    });
  });

  it('a level series goes to sudden death, then to the lottery', () => {
    const level = [duelResult('SF1-G1', [1, 1], [40, 40]), duelResult('SF1-G2', [1, 1], [40, 40])];
    const first = tie(level);
    expect(first.tie.winner).toBeNull();
    expect(first.fixtures.map((f) => f.id)).toContain('SF1-SD1A');
    expect(first.fixtures.find((f) => f.id === 'SF1-SD1B')!.seats).toEqual(['y', 'x']);
    const decided = tie([...level, duelResult('SF1-SD1A', [2, 1]), duelResult('SF1-SD1B', [1, 1])]);
    expect(decided.tie).toMatchObject({ winner: 'y', decidedBy: 'sudden death' });
    const allLevel = [
      ...level,
      ...['SD1A', 'SD1B', 'SD2A', 'SD2B'].map((g) => duelResult(`SF1-${g}`, [1, 1], [40, 40])),
    ];
    expect(tie(allLevel).tie.decidedBy).toBe('lottery');
  });
});

describe('a whole tournament', () => {
  it.each([2, 3, 5, 6, 8, 9, 12])('%i bots: finishes, the strongest wins, the ranking is complete', (n) => {
    const { plan } = playOut(n);
    expect(plan.ranking).toHaveLength(n);
    expect(plan.ranking![0]).toBe(`bot${n}`);
    expect(new Set(plan.fixtures.map((f) => f.id)).size).toBe(plan.fixtures.length);
  });

  it('8 bots: quarter-finals, a third-place match and an exhibition for the stream', () => {
    const { plan } = playOut(8);
    expect(plan.playoff!.rounds.map((r) => r.name)).toEqual(['SF', 'F']);
    expect(plan.playoff!.thirdPlace?.winner).toBe('bot6');
    expect(plan.ranking!.slice(0, 4)).toEqual(['bot8', 'bot7', 'bot6', 'bot5']);
    expect(plan.fixtures.some((f) => f.id === 'EXH' && f.stage === 'exhibition')).toBe(true);
  });

  it('is the same tournament every time for the same seed and results', () => {
    expect(playOut(9).plan).toEqual(playOut(9).plan);
  });
});

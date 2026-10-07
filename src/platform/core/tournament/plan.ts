import { deriveSeed } from '../random';
import { drawGroups, groupFixtures, groupStandings } from './groups';
import {
  evaluateTie,
  firstRound,
  loserOf,
  nextPowerOfTwo,
  rankAcrossGroups,
  roundName,
  seedQualifiers,
} from './playoff';
import { Entrant, Fixture, FixtureResult, GroupState, TieState, TournamentPlan, WorldCupConfig } from './types';

/**
 * Where a tournament stands, as a pure function of its configuration, seed and results so far:
 * the groups and their tables, every match known yet, which ones can be played now, the bracket,
 * and the final ranking once it is over. Running a tournament is: plan, play what is pending,
 * record the results, plan again.
 */
export function planTournament(
  config: WorldCupConfig,
  entrants: readonly Entrant[],
  seed: number,
  resultList: readonly FixtureResult[],
): TournamentPlan {
  if (entrants.length < 2) throw new Error('a tournament needs at least two bots');
  const results = new Map(resultList.map((r) => [r.fixtureId, r]));
  const fixtures: Fixture[] = [];

  const groups: GroupState[] = drawGroups(
    entrants.map((e) => e.id),
    config.groupSize,
    seed,
  ).map((group) => {
    const own = groupFixtures(group, config, seed);
    fixtures.push(...own);
    return {
      name: group.name,
      entrants: group.entrants,
      standings: groupStandings(group.entrants, own, results, config, seed),
      complete: own.every((f) => results.has(f.id)),
    };
  });
  const groupOf = (id: string) => groups.find((g) => g.entrants.includes(id))?.name;

  let playoff: TournamentPlan['playoff'] = null;
  let ranking: string[] | null = null;
  if (groups.every((g) => g.complete)) {
    const seeds = seedQualifiers(groups, Math.max(1, config.qualifiersPerGroup), seed);
    const rounds: { name: string; ties: TieState[] }[] = [];
    let pairs = firstRound(seeds, groupOf);
    for (let size = nextPowerOfTwo(seeds.length), first = true; size >= 2; size /= 2, first = false) {
      const name = roundName(size);
      const ties = pairs.map(([a, b], i) => {
        const evaluated = evaluateTie(`${name}${size > 2 ? i + 1 : ''}`, name, a, b, first, config, seed, results);
        fixtures.push(...evaluated.fixtures);
        return evaluated.tie;
      });
      rounds.push({ name, ties });
      pairs = [];
      for (let i = 0; i + 1 < ties.length; i += 2) pairs.push([ties[i].winner, ties[i + 1].winner]);
    }

    const semis = rounds.find((r) => r.name === 'SF')?.ties ?? [];
    let thirdPlace: TieState | null = null;
    if (config.playoff.thirdPlace && semis.length === 2) {
      const evaluated = evaluateTie('3P', '3P', loserOf(semis[0]), loserOf(semis[1]), false, config, seed, results);
      fixtures.push(...evaluated.fixtures);
      thirdPlace = evaluated.tie;
    }
    const exhibition = exhibitionFixture(config, semis, seed);
    if (exhibition) fixtures.push(exhibition);
    playoff = { rounds, thirdPlace };

    const final = rounds[rounds.length - 1].ties[0];
    const thirdDone = !thirdPlace || thirdPlace.winner !== null;
    if (final.winner && thirdDone) ranking = finalRanking(rounds, thirdPlace, groups, seeds, seed);
  }

  const pending = fixtures.filter((f) => !results.has(f.id));
  return { groups, fixtures, pending, playoff, ranking };
}

/** The unscored free-for-all of the semifinalists, once they are known and the game has a format for them. */
function exhibitionFixture(config: WorldCupConfig, semis: TieState[], seed: number): Fixture | null {
  const players = semis.flatMap((t) => [t.a, t.b]);
  const format = config.ffa?.formats[String(players.length)];
  if (!config.playoff.exhibition || !config.ffa || !format || semis.length !== 2 || players.some((p) => p === null))
    return null;
  const variant = config.ffa.variants[0];
  return {
    id: 'EXH',
    stage: 'exhibition',
    kind: 'ffa',
    seats: players as string[],
    setup: { format, variant, maxTurns: config.ffa.maxTurns, seed: deriveSeed(seed, 'EXH') },
    label: `Exhibition · semifinalists free-for-all · ${variant}`,
  };
}

/**
 * Champion, runner-up, then the third-place match (or both semifinal losers), then everyone else
 * by the round they reached, and by their group record within it.
 */
function finalRanking(
  rounds: { name: string; ties: TieState[] }[],
  thirdPlace: TieState | null,
  groups: GroupState[],
  seeds: string[],
  seed: number,
): string[] {
  const ranking: string[] = [];
  const add = (ids: (string | null)[]) => ids.forEach((id) => id && !ranking.includes(id) && ranking.push(id));
  const final = rounds[rounds.length - 1].ties[0];
  add([final.winner, loserOf(final)]);
  if (thirdPlace) add([thirdPlace.winner, loserOf(thirdPlace)]);
  for (const round of [...rounds].reverse())
    add(round.ties.map(loserOf).sort((x, y) => seeds.indexOf(x!) - seeds.indexOf(y!)));
  const rest = rankAcrossGroups(
    groups.flatMap((g) => g.standings).filter((row) => !ranking.includes(row.id)),
    seed,
  );
  add(rest.map((r) => r.id));
  return ranking;
}

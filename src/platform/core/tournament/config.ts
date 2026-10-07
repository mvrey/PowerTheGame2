import { GamePackage } from '../bots';
import { AnyGame } from '../game';
import { WorldCupConfig } from './types';

/** Partial overrides, as written in a tournament file. */
export type WorldCupOverrides = Partial<Omit<WorldCupConfig, 'duel' | 'ffa' | 'playoff' | 'points'>> & {
  duel?: Partial<WorldCupConfig['duel']>;
  ffa?: Partial<NonNullable<WorldCupConfig['ffa']>> | null;
  playoff?: Partial<WorldCupConfig['playoff']>;
  points?: Partial<WorldCupConfig['points']>;
};

/**
 * A World Cup for any game: duels on the game's two-seat format over its first two default
 * variants, free-for-all sets on every format with more seats, the playoff on the first variant.
 */
export function defaultWorldCup(pkg: GamePackage): WorldCupConfig {
  const { game, defaults } = pkg;
  const duel = game.formats.find((f) => f.players === 2);
  if (!duel) throw new Error(`${game.id} has no two-player format: the World Cup needs one`);
  const ffaFormats = Object.fromEntries(
    game.formats.filter((f) => f.players > 2).map((f) => [String(f.players), f.id]),
  );
  const variants = defaults.variants.length ? [...defaults.variants] : [game.variants[0]];
  return {
    groupSize: 4,
    qualifiersPerGroup: 2,
    duel: { format: duel.id, variants: variants.slice(0, 2), maxTurns: defaults.maxTurns },
    ffa: Object.keys(ffaFormats).length
      ? { formats: ffaFormats, variants: variants.slice(0, 1), maxTurns: defaults.maxTurns }
      : null,
    playoff: {
      variants: variants.slice(0, 1),
      maxTurns: defaults.maxTurns,
      suddenDeath: 2,
      thirdPlace: true,
      exhibition: true,
    },
    points: { win: 3, draw: 1, loss: 0 },
  };
}

export function withOverrides(base: WorldCupConfig, o: WorldCupOverrides = {}): WorldCupConfig {
  return {
    groupSize: o.groupSize ?? base.groupSize,
    qualifiersPerGroup: o.qualifiersPerGroup ?? base.qualifiersPerGroup,
    duel: { ...base.duel, ...o.duel },
    ffa: o.ffa === null || !base.ffa ? null : { ...base.ffa, ...o.ffa },
    playoff: { ...base.playoff, ...o.playoff },
    points: { ...base.points, ...o.points },
  };
}

/** Every problem with a configuration for this game, in plain words; empty when it is sound. */
export function validateWorldCup(config: WorldCupConfig, game: AnyGame): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string) => ok || problems.push(message);
  const players = (format: string) => game.formats.find((f) => f.id === format)?.players;
  const variantsOk = (list: string[]) => list.length > 0 && list.every((v) => game.variants.includes(v));
  const turnsOk = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1000;

  check(Number.isInteger(config.groupSize) && config.groupSize >= 3 && config.groupSize <= 8, 'groupSize: 3 to 8');
  check(
    Number.isInteger(config.qualifiersPerGroup) && config.qualifiersPerGroup >= 1,
    'qualifiersPerGroup: at least 1',
  );
  check(players(config.duel.format) === 2, `duel.format: a two-player format of ${game.id}`);
  check(variantsOk(config.duel.variants), `duel.variants: some of ${game.variants.join(', ')}`);
  check(turnsOk(config.duel.maxTurns), 'duel.maxTurns: 1 to 1000');
  if (config.ffa) {
    for (const [count, format] of Object.entries(config.ffa.formats))
      check(players(format) === Number(count), `ffa.formats: "${count}" must name a ${count}-player format`);
    check(variantsOk(config.ffa.variants), `ffa.variants: some of ${game.variants.join(', ')}`);
    check(turnsOk(config.ffa.maxTurns), 'ffa.maxTurns: 1 to 1000');
  }
  check(variantsOk(config.playoff.variants), `playoff.variants: some of ${game.variants.join(', ')}`);
  check(turnsOk(config.playoff.maxTurns), 'playoff.maxTurns: 1 to 1000');
  check(
    Number.isInteger(config.playoff.suddenDeath) && config.playoff.suddenDeath >= 0,
    'playoff.suddenDeath: 0 or more',
  );
  const { win, draw, loss } = config.points;
  check([win, draw, loss].every(Number.isFinite) && win > draw && draw >= loss, 'points: win > draw ≥ loss');
  return problems;
}

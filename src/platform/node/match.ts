import { GamePackage } from '../core/bots';
import { MatchSetup } from '../core/game';
import { DEFAULT_LIMITS, Limits } from '../core/protocol';
import { runMatch } from '../core/referee';
import { Replay, TurnRecord } from '../core/replay';
import { ResolvedBot, Runner } from './runners';

export interface PlayOptions {
  pkg: GamePackage;
  runner: Runner;
  /** By seat. */
  bots: ResolvedBot[];
  setup: MatchSetup;
  matchId: string;
  limits?: Partial<Limits>;
  label?: string;
  onTurn?: (record: TurnRecord) => void;
}

/** Plays one match between resolved bots with a runner. */
export function playMatch(o: PlayOptions): Promise<Replay> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...o.limits };
  return runMatch({
    game: o.pkg.game,
    matchId: o.matchId,
    setup: o.setup,
    bots: o.bots.map(({ id, name, version }) => ({ id, name, version })),
    launchers: o.bots.map((bot, seat) => o.runner.launcher(bot, { id: o.matchId, seat }, limits)),
    limits,
    label: o.label,
    onTurn: o.onTurn,
  });
}

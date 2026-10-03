import { Bot } from './bot';
import { LocalGameClient } from './client';
import { TurnProblem, makeRng, playTurn } from './driver';
import { Match, MatchStatus, RoundReport } from './match';

export interface HeadlessOptions {
  /** Seed for the bots' random numbers; each seat gets its own stream. */
  seed?: number;
  /** The game ends after this round, the strongest player winning (default 100). */
  maxRounds?: number;
  onRound?: (report: RoundReport) => void;
  onProblem?: (player: number, problem: TurnProblem) => void;
}

/**
 * Plays `match` to the end with one bot per seat (`bots[player]`), without any interface.
 * Seats without a bot give no orders. Deterministic for a given seed.
 */
export async function runHeadless(match: Match, bots: (Bot | null | undefined)[], opts: HeadlessOptions = {}): Promise<MatchStatus> {
  const seed = opts.seed ?? 1;
  const maxRounds = opts.maxRounds ?? 100;
  const rngs = match.state.players.map((p) => makeRng(seed * 7919 + p.id * 104729));
  while (!match.state.over) {
    for (const p of match.state.players) {
      const bot = bots[p.id];
      if (!p.alive || !bot) continue;
      await playTurn(bot, new LocalGameClient(match, p.id), {
        rng: rngs[p.id],
        onProblem: (problem) => opts.onProblem?.(p.id, problem),
      });
    }
    const report = match.resolveRound({ lastRound: match.state.round >= maxRounds });
    opts.onRound?.(report);
  }
  return match.status();
}

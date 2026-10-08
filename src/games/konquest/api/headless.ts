import { Rng, makeRng, randomSeed } from '../../../platform/core/random';
import { Bot, BotContext, seatRng, timeSlicer } from './bot';
import { Match, TurnReport } from './match';

export interface HeadlessOptions {
  /** Seed for the bots' random numbers; each seat gets its own stream. */
  seed?: number;
  /** The game ends after this turn, whoever is left (default 100). */
  maxTurns?: number;
  onTurn?: (report: TurnReport) => void;
  /** A bot threw, or gave illegal orders. */
  onProblem?: (player: number, problem: unknown) => void;
  signal?: AbortSignal;
  /** See BotContext.checkpoint: by default bots never pause. */
  checkpoint?: () => Promise<void>;
}

/** Asks a bot for its orders; a bot that throws sends nothing. Only an abort propagates. */
export async function decide(
  bot: Bot,
  match: Match,
  player: number,
  ctx: BotContext,
  onProblem?: (problem: unknown) => void,
) {
  let orders: unknown = [];
  try {
    orders = await bot.decide(match.view(player), ctx);
    if (!Array.isArray(orders)) throw new TypeError('decide() must return an array of orders');
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    onProblem?.(error);
    orders = [];
  }
  const problems = match.submit(player, orders as unknown[]);
  if (problems.length) onProblem?.(problems);
}

/**
 * Plays `match` to the end with one bot per seat (`bots[player]`), without any interface.
 * Seats without a bot send nothing. Deterministic for a given seed.
 */
export async function runHeadless(match: Match, bots: (Bot | null | undefined)[], opts: HeadlessOptions = {}) {
  const seed = opts.seed ?? randomSeed();
  const maxTurns = opts.maxTurns ?? 100;
  const rngs: Rng[] = match.state.players.map((p) => seatRng(seed, p.id));
  const signal = opts.signal ?? new AbortController().signal;
  const checkpoint = opts.checkpoint ?? timeSlicer(Infinity, async () => {}, signal);
  while (!match.state.over) {
    for (const p of match.state.players) {
      const bot = bots[p.id];
      if (!p.alive || !bot) continue;
      await decide(bot, match, p.id, { rng: rngs[p.id] ?? makeRng(seed), checkpoint, signal }, (problem) =>
        opts.onProblem?.(p.id, problem),
      );
    }
    const report = match.resolve({ lastTurn: match.state.turn >= maxTurns });
    opts.onTurn?.(report);
  }
  return match.state;
}

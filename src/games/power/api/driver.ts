import { cloneState } from '../engine/game';
import { Bot, BotContext, Rng } from './bot';
import { GameClient, movedPast } from './client';
import { MatchStatus, SubmitResult } from './match';
import { OrderProblem, OrderSheet } from './orderSheet';
import { makeRng, randomSeed } from './random';
import { abortError, timeSlicer } from '../../../platform/core/botkit';

export { timeSlicer };

export interface TurnOptions {
  rng?: Rng;
  /** See BotContext.checkpoint. By default it never pauses. */
  checkpoint?: () => Promise<void>;
  signal?: AbortSignal;
  /** Told when the bot throws or gives illegal orders. */
  onProblem?: (problem: TurnProblem) => void;
}

export type TurnProblem =
  | { kind: 'crashed'; round: number; error: unknown }
  | { kind: 'illegal'; round: number; problems: OrderProblem[]; orders: unknown[] }
  | { kind: 'refused'; round: number; result: SubmitResult };

/**
 * Plays one round for `bot`: gets the view, asks the bot, submits its orders.
 *
 * A bot can not spoil the game: if it throws it gives no orders; illegal orders are dropped
 * (keeping the legal ones, in sequence) and reported through `onProblem`. Only an abort
 * (through `signal`) propagates, and then nothing is submitted.
 */
export async function playTurn(bot: Bot, client: GameClient, opts: TurnOptions = {}): Promise<SubmitResult> {
  const view = await client.view();
  const pristine = cloneState(view.state);
  const signal = opts.signal ?? new AbortController().signal;
  const ctx: BotContext = {
    rng: opts.rng ?? makeRng(randomSeed()),
    checkpoint: opts.checkpoint ?? timeSlicer(Infinity, async () => {}, signal),
    signal,
  };

  let orders: unknown[] = [];
  try {
    const answer: unknown = await bot.decide(view, ctx);
    if (!Array.isArray(answer)) throw new TypeError('decide() must return an array of orders');
    orders = answer;
  } catch (error) {
    if (signal.aborted) throw error;
    opts.onProblem?.({ kind: 'crashed', round: view.round, error });
  }
  if (signal.aborted) throw abortError(signal);

  // Keep what is legal, in sequence, judged on the untouched state.
  const sheet = new OrderSheet(pristine, view.me);
  const problems = sheet.addAll(orders);
  if (problems.length) opts.onProblem?.({ kind: 'illegal', round: view.round, problems, orders });

  const result = await client.submit(sheet.orders);
  if (!result.accepted) opts.onProblem?.({ kind: 'refused', round: view.round, result });
  return result;
}

/**
 * Plays a whole match for `bot` through `client`: every round, waits for its turn, then plays
 * it. Returns the final status once the game is over or the seat is eliminated.
 */
export async function playMatch(bot: Bot, client: GameClient, opts: TurnOptions = {}): Promise<MatchStatus> {
  let status = await client.status();
  for (;;) {
    if (status.over || !status.players[client.player]?.alive) return status;
    if (status.waitingFor.includes(client.player)) await playTurn(bot, client, opts);
    const round = status.round;
    do {
      if (opts.signal?.aborted) throw abortError(opts.signal);
      status = await client.status(round);
    } while (!movedPast(status, round));
  }
}

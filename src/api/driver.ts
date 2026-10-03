import { cloneState } from '../engine/game';
import { Order } from '../engine/types';
import { Bot, BotContext, Rng } from './bot';
import { GameClient, movedPast } from './client';
import { MatchStatus, SubmitResult } from './match';
import { OrderSheet } from './orderSheet';
import { OrderProblem } from './simulate';

/** Mulberry32: small, fast, seedable. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed from the clock and Math.random, for games that need not be replayed. */
export const randomSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

/**
 * A checkpoint that pauses (with `breathe`) once at least `sliceMs` have gone by since the last
 * pause, and throws once `signal` is aborted.
 */
export function timeSlicer(sliceMs: number, breathe: () => Promise<void>, signal?: AbortSignal): () => Promise<void> {
  let since = performance.now();
  return async () => {
    if (signal?.aborted) throw abortError(signal);
    if (performance.now() - since < sliceMs) return;
    await breathe();
    if (signal?.aborted) throw abortError(signal);
    since = performance.now();
  };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Aborted');
}

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
  const problems: OrderProblem[] = [];
  orders.forEach((order, index) => {
    const error = sheet.check(order as Order);
    if (error) problems.push({ index, error });
    else sheet.add(order as Order);
  });
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

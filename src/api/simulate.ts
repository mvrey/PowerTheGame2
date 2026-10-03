import { cloneState } from '../engine/game';
import { resolveRound } from '../engine/resolve';
import { GameState, Order, OrderError, RoundEvent } from '../engine/types';
import { OrderSheet } from './orderSheet';

export interface SimulateOptions {
  /** Return the round's events (battles, captures, income...). Off by default: it is faster. */
  events?: boolean;
  /** Play it as the final round (the time limit is up): the strongest player wins. */
  lastRound?: boolean;
}

export interface SimulationResult {
  /** The state after the round. */
  state: GameState;
  /** The round's events, when asked for. */
  events: RoundEvent[];
}

/**
 * Plays one round on a copy of `state` with the real rules. `orders[p]` are player p's orders;
 * missing players give none (and pay the usual penalty). `state` itself is not changed.
 */
export function simulate(state: GameState, orders: readonly (readonly Order[] | undefined)[], opts: SimulateOptions = {}): SimulationResult {
  const next = cloneState(state);
  const all = next.players.map((p) => [...(orders[p.id] ?? [])]);
  const events = resolveRound(next, all, { record: opts.events, lastRound: opts.lastRound });
  return { state: next, events };
}

export interface OrderProblem {
  /** Position of the order in the list. */
  index: number;
  error: OrderError;
}

/** Checks a whole order list as the player would submit it. Empty when every order is legal. */
export function checkOrders(state: GameState, player: number, orders: readonly unknown[]): OrderProblem[] {
  const sheet = new OrderSheet(state, player);
  const problems: OrderProblem[] = [];
  orders.forEach((order, index) => {
    const error = sheet.check(order as Order);
    if (error) problems.push({ index, error });
    else sheet.add(order as Order);
  });
  return problems;
}

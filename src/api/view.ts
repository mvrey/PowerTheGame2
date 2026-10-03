import { cloneState, livingArmies, orderAllowance } from '../engine/game';
import { GameState, MERC, ORDERS_PER_ARMY, ReadonlyGameState } from '../engine/types';

/**
 * Everything a player needs to decide a round. Plain JSON data, so the same view reaches a bot
 * in the browser, in a test or on the other side of an HTTP connection.
 *
 * Power hides nothing but the orders being written, so the view carries the whole state.
 */
export interface PlayerView {
  /** Your player index (the index into `state.players`). */
  me: number;
  /** The round being planned. */
  round: number;
  /** The full game state. It is your own copy: change it freely. */
  state: GameState;
  /** Your living armies. */
  armies: number[];
  /** Armies you may give orders to: yours, plus the mercenary army in 3-player games. */
  commandable: number[];
  /** How many orders you may give this round in total (5 per living army of yours). */
  maxOrders: number;
  /** Most orders a single army of yours may receive. Mercenary orders count only towards the total. */
  ordersPerArmy: number;
  /** You have already submitted orders this round (you may still replace them). */
  submitted: boolean;
}

export function createView(state: ReadonlyGameState, player: number, submitted = false): PlayerView {
  const armies = state.players[player] ? livingArmies(state, player) : [];
  const mercs = state.armies.filter((a) => a.alive && a.controller === MERC).map((a) => a.id);
  return {
    me: player,
    round: state.round,
    state: cloneState(state),
    armies,
    commandable: [...armies, ...mercs].sort((a, b) => a - b),
    maxOrders: state.players[player] ? orderAllowance(state, player) : 0,
    ordersPerArmy: ORDERS_PER_ARMY,
    submitted,
  };
}

import { cloneState } from '../engine/game';
import { resolveRound } from '../engine/resolve';
import { GameState, Order, ReadonlyGameState, RoundEvent } from '../engine/types';

export interface SimulateOptions {
  /** Return the round's events (battles, captures, income...). Off by default: it is faster. */
  events?: boolean;
  /** Play it as the final round (the time limit is up): the strongest player wins. */
  lastRound?: boolean;
  /** Attach a board snapshot to every event (implies events), for animated playback. */
  snapshots?: boolean;
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
export function simulate(
  state: ReadonlyGameState,
  orders: readonly (readonly Order[] | undefined)[],
  opts: SimulateOptions = {},
): SimulationResult {
  const next = cloneState(state);
  const all = next.players.map((p) => [...(orders[p.id] ?? [])]);
  const events = resolveRound(next, all, {
    record: opts.events || opts.snapshots,
    snapshots: opts.snapshots,
    lastRound: opts.lastRound,
  });
  return { state: next, events };
}

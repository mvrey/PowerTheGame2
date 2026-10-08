import { Rng } from '../../../platform/core/random';
import { ResolveOptions, cloneState, resolveTurn } from '../engine/rules';
import { FleetOrder, GameState, ReadonlyGameState, TurnEvent } from '../engine/types';
import { PublicState, publicState } from './view';

/**
 * Plays one turn on a copy of a state with the real rules. The orders must be legal (see
 * checkOrders). A public state has no dice: battles then roll `rng`, so a bot can imagine a turn
 * (and the next, and the next) without knowing how the real battles will go.
 */
export function simulate(
  state: ReadonlyGameState | PublicState,
  orders: readonly (readonly FleetOrder[] | undefined)[],
  opts: ResolveOptions & { rng?: Rng } = {},
): { state: PublicState; events: TurnEvent[] } {
  const full = cloneState(state as ReadonlyGameState) as GameState;
  if (!('dice' in state) || opts.rng) full.dice = Math.floor((opts.rng ?? Math.random)() * 0x100000000) >>> 0;
  full.nextFleetId ??= Math.max(0, ...full.fleets.map((f) => f.id + 1));
  const events = resolveTurn(full, orders, opts);
  return { state: publicState(full), events };
}

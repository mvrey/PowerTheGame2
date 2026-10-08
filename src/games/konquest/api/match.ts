import { NewGame, createGame } from '../engine/galaxy';
import { checkOrders, cloneState, resolveTurn } from '../engine/rules';
import { FleetOrder, GameState, OrderError, ReadonlyGameState, TurnEvent } from '../engine/types';
import { PlayerView, createView } from './view';

export interface TurnReport {
  /** The turn just played. */
  turn: number;
  /** Every seat's orders, as accepted (null for seats that were out). */
  orders: (FleetOrder[] | null)[];
  events: TurnEvent[];
}

/**
 * A game being played on this computer: the browser game and the headless runner hold the
 * state here, collect each seat's orders and play the turn once everyone is in.
 */
export class Match {
  private submitted = new Map<number, FleetOrder[]>();

  constructor(private current: GameState) {}

  static create(spec: NewGame): Match {
    return new Match(createGame(spec));
  }

  get state(): ReadonlyGameState {
    return this.current;
  }

  exportState(): GameState {
    return cloneState(this.current);
  }

  view(player: number): PlayerView {
    return createView(this.current, player);
  }

  /** Seats that still have to hand in this turn's orders. */
  get waitingFor(): number[] {
    return this.current.over
      ? []
      : this.current.players.filter((p) => p.alive && !this.submitted.has(p.id)).map((p) => p.id);
  }

  hasSubmitted(player: number): boolean {
    return this.submitted.has(player);
  }

  /** Hands in (or replaces) a seat's orders; the legal ones are kept and the others reported. */
  submit(player: number, orders: readonly unknown[]): { index: number; error: OrderError }[] {
    const { orders: kept, problems } = checkOrders(this.current, player, orders);
    this.submitted.set(player, kept);
    return problems;
  }

  /** Plays the turn with what was handed in (seats that did not submit send nothing). */
  resolve(opts: { lastTurn?: boolean } = {}): TurnReport {
    const turn = this.current.turn;
    const orders = this.current.players.map((p) => (p.alive ? (this.submitted.get(p.id) ?? []) : null));
    const events = resolveTurn(
      this.current,
      orders.map((o) => o ?? []),
      opts,
    );
    this.submitted.clear();
    return { turn, orders, events };
  }
}

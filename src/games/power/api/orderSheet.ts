import { cloneState, livingArmies, orderAllowance, ordersLeft, withinBudget } from '../engine/game';
import { applyOrder, canonicalOrder, checkOrder, isWellFormed } from '../engine/rules';
import { GameState, Order, OrderError, ReadonlyGameState } from '../engine/types';

export interface OrderProblem {
  /** Position of the order in the list. */
  index: number;
  error: OrderError;
}

/**
 * A player's order list for one round, built one order at a time.
 *
 * Every order is checked against the order allowance and against the board as the earlier
 * orders leave it (`preview`): after buying a Soldier, the Soldier is in the Reserve and can be
 * deployed; after moving a piece, it cannot move again. A sheet only ever holds orders that
 * are legal in sequence, so submitting it never fails.
 *
 * Other players' orders are not known, so they are not part of the preview.
 */
export class OrderSheet {
  private list: Order[] = [];
  private projected: GameState;

  /**
   * @param base The state at the start of the round (not modified).
   * @param player Who writes the orders.
   * @param orders Initial orders; any that are not legal in sequence are left out.
   */
  constructor(
    private readonly base: ReadonlyGameState,
    readonly player: number,
    orders: readonly Order[] = [],
  ) {
    this.projected = cloneState(base);
    this.addAll(orders);
  }

  /** The orders so far, in execution order. */
  get orders(): readonly Order[] {
    return this.list;
  }

  /** The board once the orders so far are carried out (ignoring everyone else). */
  get preview(): ReadonlyGameState {
    return this.projected;
  }

  /** The state the sheet was started from. */
  get start(): ReadonlyGameState {
    return this.base;
  }

  /** Why `order` cannot be added now, or null when it can. */
  check(order: Order): OrderError | null {
    if (!isWellFormed(order)) return 'malformed';
    if (!withinBudget(this.base, this.player, this.list, order)) return 'budget';
    return checkOrder(this.projected, this.player, order);
  }

  /** Adds `order` if it is legal now; returns whether it was added. */
  add(order: Order): boolean {
    if (this.check(order)) return false;
    const copy = canonicalOrder(order);
    applyOrder(this.projected, copy);
    this.list.push(copy);
    return true;
  }

  /**
   * Adds, in sequence, every order that is legal at its turn. Orders may come from untrusted
   * sources, so anything at all is accepted; returns why each of the others was left out.
   */
  addAll(orders: readonly unknown[]): OrderProblem[] {
    const problems: OrderProblem[] = [];
    orders.forEach((order, index) => {
      const error = this.check(order as Order);
      if (error) problems.push({ index, error });
      else this.add(order as Order);
    });
    return problems;
  }

  /**
   * Removes the order at `index`. Later orders that depended on it (deploying a piece it bought,
   * say) are dropped too; returns how many orders were dropped besides the removed one.
   */
  removeAt(index: number): number {
    const rest = this.list.filter((_, i) => i !== index);
    this.reset();
    for (const o of rest) this.add(o);
    return rest.length - this.list.length;
  }

  /** Removes every order. */
  clear(): void {
    this.reset();
  }

  /** Orders still available for `army` (the total allowance also applies). */
  left(army: number): number {
    return ordersLeft(this.base, this.player, this.list, army);
  }

  /** Total orders allowed this round. */
  get max(): number {
    return orderAllowance(this.base, this.player);
  }

  /** No order can be added any more. */
  get full(): boolean {
    return livingArmies(this.base, this.player).every((a) => this.left(a) === 0);
  }

  private reset(): void {
    this.list = [];
    this.projected = cloneState(this.base);
  }
}

/** Checks a whole order list as the player would submit it. Empty when every order is legal. */
export function checkOrders(state: ReadonlyGameState, player: number, orders: readonly unknown[]): OrderProblem[] {
  return new OrderSheet(state, player).addAll(orders);
}

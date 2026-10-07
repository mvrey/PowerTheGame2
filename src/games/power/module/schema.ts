import type { BoardInfo, GameState, Order, OrderError, PieceDef, PieceType, RoundEvent } from '../api';

// The JSON that Power bots receive and send. Documented for participants in Docs/Games/Power.md;
// any change here is a change of the game's version (POWER_GAME_VERSION).

/** `hello.info`: facts that do not change during a match. */
export interface PowerMatchInfo {
  board: BoardInfo;
  pieces: Record<PieceType, PieceDef>;
  rules: {
    missileCost: number;
    ordersPerArmy: number;
    /** `loc` of a piece in a Reserve, `from`/`target` of orders about a Reserve. */
    reserve: number;
    /** `controller` of the mercenary army (three-player games). */
    mercenary: number;
    moveRange: Record<string, number>;
  };
  /** Your seat. */
  you: number;
  /** The armies of every seat. */
  seats: { armies: number[] }[];
  maxRounds: number;
}

/** `turn.observation`. */
export interface PowerObservation {
  round: number;
  maxRounds: number;
  you: number;
  /** Your living armies. */
  armies: number[];
  /** Armies you may order: yours, plus the mercenary army in three-player games. */
  commandable: number[];
  maxOrders: number;
  ordersPerArmy: number;
  /** The whole game state: Power hides nothing but the orders being written. */
  state: GameState;
  /** Every order that could be given first this round (later ones depend on what came before). */
  legal: Order[];
  /** The round just played; null in round 1. */
  previous: {
    round: number;
    /** Every seat's accepted orders (null for seats that were out). */
    orders: (Order[] | null)[];
    events: RoundEvent[];
    /** What was refused in your own orders, by position in what you sent. */
    problems: { code: OrderError | string; index?: number }[];
  } | null;
}

/** The `action` of an `action` message. */
export interface PowerAction {
  orders: Order[];
}

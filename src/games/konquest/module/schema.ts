import type { FleetOrder, OrderError, PublicState, Rules, TurnEvent } from '../api';

// The JSON that Konquest bots receive and send. Documented for participants in
// Docs/Games/Konquest.md; any change here is a change of the game's version (KONQUEST_GAME_VERSION).

/** `hello.info`: facts that do not change during a match. */
export interface KonquestMatchInfo {
  /** Your seat. */
  you: number;
  players: number;
  /** The galaxy grid, in sectors. */
  width: number;
  height: number;
  /** The planet each seat started on. */
  homes: number[];
  rules: Rules;
  /** The planets' starting stats, as KDE draws them. */
  constants: {
    homeProduction: number;
    homeKill: number;
    neutralKill: [number, number];
    neutralProduction: [number, number];
  };
  maxTurns: number;
}

/** `turn.observation`. */
export interface KonquestObservation {
  turn: number;
  maxTurns: number;
  you: number;
  /** The whole game but the dice: every planet (owner, ships, production, kill) and every fleet in flight. */
  state: PublicState;
  /** The turn just played; null in turn 1. */
  previous: {
    turn: number;
    /** Every seat's accepted orders (null for seats that were out). */
    orders: (FleetOrder[] | null)[];
    events: TurnEvent[];
    /** What was refused in your own orders, by position in what you sent. */
    problems: { code: OrderError | string; index?: number }[];
  } | null;
}

/** The `action` of an `action` message. */
export interface KonquestAction {
  orders: FleetOrder[];
}

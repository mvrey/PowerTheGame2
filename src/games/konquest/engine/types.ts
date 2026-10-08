// The data of a Konquest game. Plain JSON, so that a state can be saved, sent to a bot, hashed
// and replayed. The rules follow KDE's Konquest (konquest/src, GPL-2.0-or-later), rewritten here
// as pure functions: see rules.ts, galaxy.ts and Docs/Games/Konquest.md.

/** `owner` of a planet nobody holds. */
export const NEUTRAL = -1;

/** KDE's home planets: production 10, kill percentage 0.400. */
export const HOME_PRODUCTION = 10;
export const HOME_KILL = 0.4;
/** KDE's neutral planets: kill 0.30 + [0, 0.60), production 5 + [0, 10). */
export const NEUTRAL_KILL_MIN = 0.3;
export const NEUTRAL_KILL_RANGE = 0.6;
export const NEUTRAL_PRODUCTION_MIN = 5;
export const NEUTRAL_PRODUCTION_RANGE = 10;

/** KDE's game options that change the rules (the others only change what the screen shows). */
export interface Rules {
  /** Every planet's production grows by one each turn. KDE default: off. */
  cumulativeProduction: boolean;
  /** A planet produces in the turn it is conquered. KDE default: on. */
  productionAfterConquest: boolean;
  /** Ships a neutral planet builds each turn (its own production only counts once owned). KDE default: 1. */
  neutralProduction: number;
}

export const DEFAULT_RULES: Rules = {
  cumulativeProduction: false,
  productionAfterConquest: true,
  neutralProduction: 1,
};

export interface Planet {
  /** Index in `planets`. */
  id: number;
  /** "A", "B"... "Z", "AA"... as KDE names them. */
  name: string;
  /** Sector of the galaxy grid: column and row. */
  x: number;
  y: number;
  /** The seat holding it, or NEUTRAL. */
  owner: number;
  /** The planet's defence fleet. */
  ships: number;
  /** Ships built per turn while owned by a player. */
  production: number;
  /** The production it had when the game started; restored when the planet changes hands. */
  baseProduction: number;
  /** Chance that one of its ships destroys an enemy ship in each exchange of fire. */
  kill: number;
  /** The seat this planet was the home of; NEUTRAL for the others. */
  home: number;
  /** Conquered during the turn being resolved (KDE: no production then, unless the rules allow it). */
  justConquered: boolean;
}

export interface Fleet {
  /** Unique within the game, in launch order. */
  id: number;
  owner: number;
  from: number;
  to: number;
  ships: number;
  /** The turn it was sent in. */
  launched: number;
  /** The turn at whose end it reaches its destination. */
  arrival: number;
}

/** What a player achieved, as KDE's score dialog lists it. */
export interface PlayerStats {
  shipsBuilt: number;
  planetsConquered: number;
  fleetsLaunched: number;
  enemyFleetsDestroyed: number;
  enemyShipsDestroyed: number;
}

export interface Player {
  id: number;
  /** Has a planet or a fleet in flight. */
  alive: boolean;
  stats: PlayerStats;
}

export type EndReason = 'conquest' | 'mutual-destruction' | 'turn-limit';

export interface GameState {
  /** The turn being planned, from 1. */
  turn: number;
  /** Size of the galaxy grid, in sectors. */
  width: number;
  height: number;
  planets: Planet[];
  /** Fleets in flight, in launch order. */
  fleets: Fleet[];
  players: Player[];
  rules: Rules;
  /** The dice of the battles: the state of a seeded generator. Never shown to bots. */
  dice: number;
  nextFleetId: number;
  over: boolean;
  /** The last player standing; null while playing, on a draw or at the turn limit. */
  winner: number | null;
  endReason: EndReason | null;
}

/** Send `ships` ships from one of your planets to any other planet. */
export interface FleetOrder {
  from: number;
  to: number;
  ships: number;
}

export const ORDER_ERRORS = ['malformed', 'noPlanet', 'notYours', 'samePlanet', 'badShips', 'notEnough'] as const;
export type OrderError = (typeof ORDER_ERRORS)[number];

/** What happened in a turn, in order: for logs, playback and bots. */
export type TurnEvent =
  /** A fleet left its planet. */
  | { kind: 'launch'; fleet: Fleet }
  /** A fleet reached a planet of its owner and joined its defence. */
  | { kind: 'reinforce'; fleet: number; owner: number; planet: number; ships: number }
  /** A fleet attacked a planet. */
  | {
      kind: 'battle';
      fleet: number;
      planet: number;
      attacker: number;
      defender: number;
      attackers: number;
      defenders: number;
      /** Ships left on each side. */
      attackersLeft: number;
      defendersLeft: number;
      conquered: boolean;
    }
  /** Each planet's new ship count after production. */
  | { kind: 'production'; ships: number[] }
  /** A player lost their last planet and fleet. */
  | { kind: 'out'; player: number }
  | { kind: 'end'; winner: number | null; reason: EndReason };

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type ReadonlyGameState = DeepReadonly<GameState>;

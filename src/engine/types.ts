import type { MoveClass } from './board';

export type PieceType = 'S' | 'T' | 'F' | 'D' | 'R' | 'H' | 'B' | 'C' | 'M';

export interface PieceDef {
  power: number;
  /** null for the megamissile, which cannot move. */
  cls: MoveClass | null;
  group: 0 | 1 | 2;
  /** Group 1: the piece three of these trade up to. */
  up?: PieceType;
  /** Group 2: the piece it is built from. */
  base?: PieceType;
}

export const PIECES: Record<PieceType, PieceDef> = {
  S: { power: 2, cls: 'inf', group: 1, up: 'R' },
  T: { power: 3, cls: 'tank', group: 1, up: 'H' },
  F: { power: 5, cls: 'air', group: 1, up: 'B' },
  D: { power: 10, cls: 'naval', group: 1, up: 'C' },
  R: { power: 20, cls: 'inf', group: 2, base: 'S' },
  H: { power: 30, cls: 'tank', group: 2, base: 'T' },
  B: { power: 25, cls: 'air', group: 2, base: 'F' },
  C: { power: 50, cls: 'naval', group: 2, base: 'D' },
  M: { power: 0, cls: null, group: 0 },
};

export const PIECE_TYPES: PieceType[] = ['S', 'T', 'F', 'D', 'R', 'H', 'B', 'C', 'M'];
export const GROUP1: PieceType[] = ['S', 'T', 'F', 'D'];
export const MISSILE_COST = 100;
export const ORDERS_PER_ARMY = 5;
export const MERC = -1;

export interface Piece {
  id: number;
  type: PieceType;
  army: number;
  /** Node index, or RESERVE. */
  loc: number;
  /** Already moved this round. */
  moved: boolean;
  /** Created by a trade on the board this round: cannot move until next round. */
  fresh: boolean;
  /** Where it moved from this round (node index or RESERVE); NO_ORIGIN if it has not moved. */
  from: number;
  bounced: boolean;
}
export const NO_ORIGIN = -2;

export interface Army {
  id: number;
  /** Player index, or MERC. */
  controller: number;
  alive: boolean;
  /** Power units held in the Reserve. */
  power: number;
  /** Flags held (army ids), including its own while alive. */
  flags: number[];
}

export interface PlayerStats {
  captured: number;
  lost: number;
  battlesWon: number;
  flags: number;
  missiles: number;
  income: number;
}

export interface Player {
  id: number;
  name: string;
  kind: 'human' | 'ai';
  armies: number[];
  alive: boolean;
  general?: string;
  level?: number;
  stats: PlayerStats;
}

export interface Strike {
  army: number;
  /** Node index, or RESERVE together with targetArmy. */
  target: number;
  targetArmy: number;
}

export interface GameState {
  /** Id of the map being played (see maps.ts). */
  map: string;
  mode: 2 | 3 | 4;
  round: number;
  /** Player index of this round's referee. */
  referee: number;
  armies: Army[];
  players: Player[];
  pieces: Piece[];
  nextId: number;
  strikes: Strike[];
  over: boolean;
  /** Winning player indices (several on a draw). */
  winners: number[];
  endReason: 'flags' | 'time' | null;
}

export type Order =
  | { k: 'move'; army: number; type: PieceType; from: number; to: number }
  | { k: 'buy'; army: number; type: PieceType }
  | { k: 'up'; army: number; type: PieceType; at: number }
  | { k: 'mk'; army: number; at: number; spend: Partial<Record<PieceType, number>>; power: number }
  | { k: 'launch'; army: number; from: number; target: number; targetArmy: number };

export type OrderError =
  | 'dead' | 'notYours' | 'noPiece' | 'cantMove' | 'unreachable' | 'onlyHQ' | 'noPower'
  | 'badType' | 'needThree' | 'tooWeak' | 'badSpend' | 'noMissile' | 'badTarget' | 'budget' | 'cancelled';

export interface Snapshot {
  pieces: { id: number; type: PieceType; army: number; loc: number }[];
  power: number[];
  alive: boolean[];
  flags: number[][];
}

interface EvBase { snap?: Snapshot }
export type RoundEvent = EvBase & (
  | { t: 'turn'; player: number }
  | { t: 'order'; player: number; index: number; order: Order; error: OrderError | null; merged?: boolean }
  | { t: 'penalty'; player: number; army: number; paid: boolean }
  | { t: 'strike'; army: number; target: number; targetArmy: number; destroyed: number; power: number }
  | { t: 'bounce'; node: number; moves: { type: PieceType; army: number; to: number }[] }
  | { t: 'standoff'; node: number; teams: number[] }
  | { t: 'battle'; node: number; powers: { team: number; power: number }[]; winner: number;
      captured: { type: PieceType; army: number; to: number }[]; value: number }
  | { t: 'income'; army: number; amount: number; territories: number[] }
  | { t: 'flag'; victim: number; captor: number; pieces: number; power: number }
  | { t: 'out'; player: number }
  | { t: 'end'; winners: number[]; reason: 'flags' | 'time' }
);

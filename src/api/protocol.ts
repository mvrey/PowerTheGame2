// JSON shapes exchanged with the HTTP server (src/server). See BOTS.md for the endpoint list.

import { Board } from '../engine/board';
import { BotLevel } from './bot';
import { MatchStatus } from './match';

export interface SeatRequest {
  /** Shown to other players. Defaults to the bot's name or "Player N". */
  name?: string;
  /** Armies for this seat. Defaults to the usual split for the mode. */
  armies?: number[];
  /** Id of a registered bot to play this seat on the server. Leave it out for a remote seat. */
  bot?: string;
  level?: BotLevel;
}

export interface CreateMatchRequest {
  map?: string;
  /** Players: 2, 3 or 4 (default: the number of seats). */
  mode?: 2 | 3 | 4;
  seats: SeatRequest[];
  /** The round is played without the orders that have not arrived after this long. */
  orderTimeoutMs?: number;
  /** The game ends after this round (the strongest player wins). Default 100. */
  maxRounds?: number;
  /** Seed for the server-side bots. */
  seed?: number;
}

export interface SeatInfo {
  player: number;
  name: string;
  armies: number[];
  /** Bot id for a server-side seat. */
  bot?: string;
  /** Remote seats only, and only in the creation response: the secret needed to submit orders. */
  token?: string;
}

export interface CreateMatchResponse {
  id: string;
  seats: SeatInfo[];
  status: MatchStatus;
}

export interface MatchSummary extends MatchStatus {
  id: string;
  seats: SeatInfo[];
}

export interface BotInfo {
  id: string;
  name: string;
  description: string;
  levels: boolean;
}

/** A board as JSON; `rounds` uses null where a unit can never get. */
export interface BoardInfo {
  id: string;
  rows: string[];
  nodes: { idx: number; id: string; kind: string; army: number; num: number; coastal: boolean }[];
  hq: number[];
  territory: number[][];
  adj: number[][];
  reach: Record<string, number[][]>;
  rounds: Record<string, (number | null)[][]>;
}

export function boardInfo(board: Board): BoardInfo {
  const classes = Object.keys(board.reach) as (keyof Board['reach'])[];
  return {
    id: board.def.id,
    rows: board.def.rows,
    nodes: board.nodes.map(({ idx, id, kind, army, num, coastal }) => ({ idx, id, kind, army, num, coastal })),
    hq: board.hq,
    territory: board.territory,
    adj: board.adj,
    reach: Object.fromEntries(classes.map((c) => [c, board.reach[c]])),
    rounds: Object.fromEntries(classes.map((c) => [c, board.rounds[c].map((row) => row.map((d) => (Number.isFinite(d) ? d : null)))])),
  };
}

export interface ApiErrorBody {
  error: string;
}

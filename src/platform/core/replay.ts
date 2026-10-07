import { ActionProblem, MatchResult, MatchSetup } from './game';

// A replay is the authoritative record of a match: enough to reproduce it with the same game
// version (the bots' raw answers go through the engine again) and to settle disputes.

export const REPLAY_FORMAT = 'jam-replay';
export const REPLAY_VERSION = 1;

/** Why a seat gave no usable answer for a turn. */
export type Failure =
  /** No answer before the deadline. */
  | 'timeout'
  /** The line was not JSON, or not a valid message. */
  | 'invalid'
  /** The process ended or broke the protocol fatally (oversized output, for instance). */
  | 'crashed'
  /** Already gone: crashed earlier, never got ready, or timed out too often. */
  | 'disconnected';

export interface ReplayBot {
  seat: number;
  /** Tournament id of the bot (e.g. "alice"), or "builtin:<id>". */
  id: string;
  /** Display name, from the bot's manifest. Bots never see it: in-game, seats are anonymous. */
  name: string;
  /** Content hash of the submission, so that a replay names the exact code that played. */
  version: string;
}

export interface TurnRecord {
  turn: number;
  /** Seats that were asked to act. */
  toAct: number[];
  /** By seat: the raw `action` value received (null when none). */
  responses: unknown[];
  /** By seat: why there was no usable answer. */
  failures: (Failure | null)[];
  /** By seat: answer time in milliseconds (null when not asked or no answer). */
  ms: (number | null)[];
  /** By seat: what the game refused in the answer. */
  problems: ActionProblem[][];
  /** The game's events for this turn. */
  events: unknown[];
  /** Fingerprint of the state after the turn. */
  hash: string;
}

export interface SeatDiagnostics {
  seat: number;
  ready: boolean;
  /** How the process ended: exit code / signal, or why it was stopped. */
  exit: string;
  /** The bot's stderr, cut at the configured limit. */
  stderr: string;
  failures: Partial<Record<Failure, number>>;
}

export interface Replay {
  format: typeof REPLAY_FORMAT;
  formatVersion: number;
  platformVersion: string;
  protocol: number;
  game: { id: string; version: string };
  match: { id: string; setup: MatchSetup; label?: string };
  bots: ReplayBot[];
  /** Fingerprint of the state before the first turn. */
  initialHash: string;
  turns: TurnRecord[];
  result: MatchResult;
  diagnostics: SeatDiagnostics[];
  /** Wall-clock times: informative, not part of verification. */
  startedAt: string;
  finishedAt: string;
}

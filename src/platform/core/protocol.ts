import { MatchResult } from './game';
import { isRecord } from './json';

// The bot protocol: one JSON object per line over the bot's stdin (referee → bot) and stdout
// (bot → referee). stderr is free for the bot's own logs. Specification: Docs/Protocol.md.

/** Bumped on every breaking change to the messages below. */
export const PROTOCOL_VERSION = 1;

export interface Limits {
  /** Time to answer `hello` with `ready` (interpreter start-up included). */
  startupMs: number;
  /** Time to answer each `turn`. */
  turnMs: number;
  /** Longest line a bot may write. Longer output disconnects it. */
  maxMessageBytes: number;
  /** stderr kept per bot and match, for the logs. The rest is discarded. */
  maxStderrBytes: number;
  /** Timeouts in a row after which a bot is disconnected for the rest of the match. */
  maxConsecutiveTimeouts: number;
}

export const DEFAULT_LIMITS: Limits = {
  startupMs: 10_000,
  turnMs: 2_000,
  maxMessageBytes: 1 << 20,
  maxStderrBytes: 64 << 10,
  maxConsecutiveTimeouts: 3,
};

export interface HelloMessage {
  type: 'hello';
  protocol: number;
  game: { id: string; version: string };
  match: { id: string; format: string; variant: string; maxTurns: number; seat: number; players: number; seed: number };
  limits: { startupMs: number; turnMs: number; maxMessageBytes: number };
  /** Game-specific facts: see the game's documentation. */
  info: unknown;
}

export interface TurnMessage {
  type: 'turn';
  turn: number;
  /** Time to answer, in milliseconds. */
  deadlineMs: number;
  observation: unknown;
}

export interface EndMessage {
  type: 'end';
  seat: number;
  result: MatchResult;
}

export type RefereeMessage = HelloMessage | TurnMessage | EndMessage;

export interface ReadyMessage {
  type: 'ready';
  /** Shown in logs only; the tournament uses the name from the bot's manifest. */
  name?: string;
}

export interface ActionMessage {
  type: 'action';
  /** The turn this answers: late answers to earlier turns are discarded. */
  turn: number;
  action: unknown;
}

export type BotMessage = ReadyMessage | ActionMessage;

/** Checks the envelope of a bot message (the action inside is the game's business). */
export function asBotMessage(value: unknown): BotMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === 'ready') return { type: 'ready', name: typeof value.name === 'string' ? value.name : undefined };
  if (value.type === 'action' && Number.isInteger(value.turn))
    return { type: 'action', turn: value.turn as number, action: value.action };
  return null;
}

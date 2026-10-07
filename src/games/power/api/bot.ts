import type { Rng } from '../../../platform/core/random';
import { Order } from '../engine/types';
import { PlayerView } from './view';

/** Random numbers in [0, 1). Hosts hand bots a seeded one so that games can be replayed. */
export type { Rng };

/** What the host lends a bot while it thinks. */
export interface BotContext {
  /** Seeded random numbers. Use these instead of Math.random. */
  readonly rng: Rng;
  /**
   * Await this now and then during long computations. It gives the host a chance to breathe
   * (the browser keeps animating, the referee keeps its deadlines) and throws once the host has
   * stopped waiting for an answer. It returns at once when no break is due, so it is cheap.
   */
  checkpoint(): Promise<void>;
  /** Aborted when the host no longer wants an answer (the game was closed, say). */
  readonly signal: AbortSignal;
}

/**
 * An AI player. The host calls `decide` once per round with a fresh view of the game and
 * submits whatever orders it returns. A bot instance plays one seat for one game, so it may
 * remember things between rounds.
 *
 * Illegal orders are dropped (and reported) rather than failing the round, and a bot that
 * throws simply gives no orders that round.
 */
export interface Bot {
  decide(view: PlayerView, ctx: BotContext): Order[] | Promise<Order[]>;
}

/** Difficulty chosen in the menus: 1 Recruit, 2 Captain, 3 General. Bots may ignore it. */
export type BotLevel = 1 | 2 | 3;
export const BOT_LEVELS: readonly BotLevel[] = [1, 2, 3];
export const isBotLevel = (value: unknown): value is BotLevel => BOT_LEVELS.includes(value as BotLevel);

export interface BotOptions {
  level: BotLevel;
}

/** Text in English, optionally with a Spanish version. */
export type Localized = string | { en: string; es?: string };

/** A kind of bot, as listed in the game's menus and as a built-in bot of the jam (builtin:<id>). */
export interface BotDefinition {
  /** Unique, stable id (used in saves, URLs and command lines): lowercase letters, digits and dashes. */
  id: string;
  /** Name shown to players. */
  name: string;
  /** One line about how it plays. */
  description?: Localized;
  /** Whether the level makes a difference (the menus hide the level picker otherwise). Default true. */
  levels?: boolean;
  /** Position in lists; lower comes first. Default 100. */
  order?: number;
  /** A new bot for one seat of one game. */
  create(options: BotOptions): Bot;
}

/** Identity helper that type-checks a bot definition. */
export function defineBot<T extends BotDefinition>(definition: T): T {
  return definition;
}

/** A description in the given language, falling back to English. */
export function localize(text: Localized | undefined, lang: string): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return (lang === 'es' && text.es) || text.en;
}

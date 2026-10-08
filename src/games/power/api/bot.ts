import type { BotContext, BotDefinition as GenericDefinition } from '../../../platform/core/botkit';
import { Order } from '../engine/types';
import { PlayerView } from './view';

// The bot contract of Power. Levels, contexts, the registry and descriptions are shared by every
// game (platform/core/botkit); what is Power's own is what a bot decides: a list of orders.

export type { BotContext, BotLevel, BotOptions, Localized, Rng } from '../../../platform/core/botkit';
export { BOT_LEVELS, isBotLevel, localize } from '../../../platform/core/botkit';

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

/** A kind of Power bot, as listed in the game's menus and as a built-in bot of the jam (builtin:<id>). */
export type BotDefinition = GenericDefinition<Bot>;

/** Identity helper that type-checks a bot definition. */
export function defineBot<T extends BotDefinition>(definition: T): T {
  return definition;
}

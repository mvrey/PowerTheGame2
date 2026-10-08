import type { BotContext, BotDefinition as GenericDefinition } from '../../../platform/core/botkit';
import { FleetOrder } from '../engine/types';
import { PlayerView } from './view';

// The bot contract of Konquest. Levels, contexts and the registry are shared by every game
// (platform/core/botkit); what is Konquest's own is what a bot decides: fleets to send.

export type { BotContext, BotLevel, BotOptions, Localized, Rng } from '../../../platform/core/botkit';
export {
  BOT_LEVELS,
  BotRegistry,
  definitionsIn,
  isBotLevel,
  localize,
  seatRng,
  timeSlicer,
} from '../../../platform/core/botkit';

/**
 * An AI player. The host calls `decide` once per turn with a fresh view and sends the fleets it
 * returns. A bot instance plays one seat for one game, so it may remember things between turns.
 * Illegal orders are dropped (and reported), and a bot that throws sends nothing that turn.
 */
export interface Bot {
  decide(view: PlayerView, ctx: BotContext): FleetOrder[] | Promise<FleetOrder[]>;
}

export type BotDefinition = GenericDefinition<Bot>;

/** Identity helper that type-checks a bot definition. */
export function defineBot<T extends BotDefinition>(definition: T): T {
  return definition;
}

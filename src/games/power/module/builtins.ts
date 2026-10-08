import { BotLevel, protocolBot, registryBuiltins } from '../../../platform/core/botkit';
import { BuiltinBot } from '../../../platform/core/bots';
import { createView } from '../api';
import { bots } from '../bots';
import { PowerObservation } from './schema';

const LEVEL_NAMES: Record<BotLevel, string> = { 1: 'Recruit', 2: 'Captain', 3: 'General' };

/**
 * The bots of the registry as trusted in-process players: every level of every general
 * ("okoye:3"), and the bots without levels under their plain id ("rookie").
 */
export function powerBuiltins(): BuiltinBot[] {
  return registryBuiltins(
    bots,
    (bot) =>
      protocolBot(async (observation, seat, ctx) => {
        const { state } = observation as PowerObservation;
        return { orders: await bot.decide(createView(state, seat), ctx) };
      }),
    LEVEL_NAMES,
  );
}

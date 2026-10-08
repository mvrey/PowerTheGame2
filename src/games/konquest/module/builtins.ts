import { protocolBot, registryBuiltins } from '../../../platform/core/botkit';
import { BuiltinBot } from '../../../platform/core/bots';
import { createView } from '../api';
import { bots } from '../bots';
import { KonquestObservation } from './schema';

/** The bots of the registry as trusted in-process players: "kde:2", "becai", "montecarlo:1"... */
export function konquestBuiltins(): BuiltinBot[] {
  return registryBuiltins(bots, (bot) =>
    protocolBot(async (observation, seat, ctx) => {
      const { state } = observation as KonquestObservation;
      return { orders: await bot.decide(createView(state, seat), ctx) };
    }),
  );
}

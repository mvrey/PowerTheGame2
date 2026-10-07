import { BuiltinBot, InProcessBot } from '../../../platform/core/bots';
import { Bot, BOT_LEVELS, BotDefinition, BotLevel, Rng, createView, localize, seatRng, timeSlicer } from '../api';
import { bots } from '../bots';
import { PowerObservation } from './schema';

const LEVEL_NAMES: Record<BotLevel, string> = { 1: 'Recruit', 2: 'Captain', 3: 'General' };
/** Built-in bots give the referee's timers a turn this often, so their deadlines are measured. */
const BREATHE_EVERY_MS = 9;

/**
 * The bots of the registry as trusted in-process players: every level of every general
 * ("okoye:3"), and the bots without levels under their plain id ("rookie").
 */
export function powerBuiltins(): BuiltinBot[] {
  return bots
    .list()
    .flatMap((def) =>
      def.levels === false
        ? [builtin(def, 2, def.id, def.name)]
        : BOT_LEVELS.map((level) => builtin(def, level, `${def.id}:${level}`, `${def.name} (${LEVEL_NAMES[level]})`)),
    );
}

function builtin(def: BotDefinition, level: BotLevel, id: string, name: string): BuiltinBot {
  return { id, name, description: localize(def.description, 'en'), create: () => speakProtocol(def.create({ level })) };
}

/** Lets a Bot of the Power API answer protocol messages. */
function speakProtocol(bot: Bot): InProcessBot {
  let seat = 0;
  let rng: Rng = Math.random;
  const abort = new AbortController();
  return {
    async receive(message) {
      switch (message.type) {
        case 'hello':
          seat = message.match.seat;
          rng = seatRng(message.match.seed, seat);
          return { type: 'ready' };
        case 'turn': {
          const observation = message.observation as PowerObservation;
          const checkpoint = timeSlicer(
            BREATHE_EVERY_MS,
            () => new Promise((resolve) => setTimeout(resolve, 0)),
            abort.signal,
          );
          const orders = await bot.decide(createView(observation.state, seat), {
            rng,
            checkpoint,
            signal: abort.signal,
          });
          return { type: 'action', turn: message.turn, action: { orders } };
        }
        case 'end':
          abort.abort();
          return null;
      }
    },
    stop: () => abort.abort(),
  };
}

import { GamePackage } from '../../../platform/core/bots';
import { powerBuiltins } from './builtins';
import { powerGame } from './game';

export { POWER_GAME_VERSION, placements, powerGame } from './game';
export type { PowerState } from './game';
export type { PowerAction, PowerMatchInfo, PowerObservation } from './schema';

export const powerPackage: GamePackage = {
  game: powerGame,
  summary:
    'Power (1981): simultaneous orders, four armies, flags to capture. No chance, no hidden state but the orders.',
  builtins: powerBuiltins(),
  templates: {
    python: { dir: 'templates/power/python', sdk: ['sdk/python/jam.py', 'sdk/python/power.py'] },
    javascript: { dir: 'templates/power/javascript', sdk: ['sdk/javascript/jam.mjs', 'sdk/javascript/power.mjs'] },
  },
  defaults: { maxTurns: 60, variants: ['classic', 'ring', 'continent'], sparring: 'rookie' },
  research: {
    balance: ['okoye:2', 'montecarlo:2'],
    versus: [
      ['montecarlo:1', 'rookie'],
      ['montecarlo:2', 'greedy'],
      ['montecarlo:2', 'okoye:2'],
      ['montecarlo:3', 'okoye:3'],
    ],
  },
};

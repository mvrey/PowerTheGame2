import { GamePackage } from '../../../platform/core/bots';
import { konquestBuiltins } from './builtins';
import { konquestGame } from './game';

export { KONQUEST_GAME_VERSION, konquestGame, placements } from './game';
export type { KonquestState } from './game';
export type { KonquestAction, KonquestMatchInfo, KonquestObservation } from './schema';

export const konquestPackage: GamePackage = {
  game: konquestGame,
  summary: 'Konquest (KDE): conquer the galaxy planet by planet. Fleets fly for turns; battles roll dice.',
  builtins: konquestBuiltins(),
  templates: {
    python: { dir: 'templates/konquest/python', sdk: ['sdk/python/jam.py', 'sdk/python/konquest.py'] },
    javascript: {
      dir: 'templates/konquest/javascript',
      sdk: ['sdk/javascript/jam.mjs', 'sdk/javascript/konquest.mjs'],
    },
  },
  defaults: { maxTurns: 100, variants: ['standard', 'small', 'large'], sparring: 'rookie' },
  research: {
    balance: ['becai', 'montecarlo:2'],
    versus: [
      ['montecarlo:1', 'rookie'],
      ['montecarlo:2', 'greedy'],
      ['montecarlo:2', 'kde:2'],
      ['montecarlo:3', 'becai'],
    ],
  },
};

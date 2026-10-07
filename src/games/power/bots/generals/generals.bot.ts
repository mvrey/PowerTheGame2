import { BotDefinition, Localized, defineBot } from '../../api';
import { Style } from './evaluate';
import { PlannerBot } from './planner';

// The built-in opponents: one planner, six temperaments. Their temperament shapes which plans
// they favour; the level sets how many plans and rival scenarios they weigh.

function general(order: number, id: string, name: string, style: Style, description: Localized): BotDefinition {
  return defineBot({ id, name, order, description, create: ({ level }) => new PlannerBot(style, level) });
}

const generals: BotDefinition[] = [
  general(
    0,
    'kruger',
    'Kruger',
    { aggression: 1.6, caution: 0.7, greed: 0.8 },
    { en: 'The Hammer: attacks relentlessly', es: 'El Martillo: ataca sin descanso' },
  ),
  general(
    1,
    'vega',
    'Vega',
    { aggression: 0.8, caution: 1.1, greed: 1.5 },
    { en: 'The Fox: hoards Power and bides her time', es: 'La Zorra: acumula Power y espera su momento' },
  ),
  general(
    2,
    'okoye',
    'Okoye',
    { aggression: 1, caution: 1, greed: 1 },
    { en: 'The Strategist: balanced in everything', es: 'El Estratega: equilibrado en todo' },
  ),
  general(
    3,
    'ivanova',
    'Ivanova',
    { aggression: 0.7, caution: 1.6, greed: 1.1 },
    { en: 'Ice: a fortress that is hard to crack', es: 'Hielo: una fortaleza difícil de romper' },
  ),
  general(
    4,
    'tanaka',
    'Tanaka',
    { aggression: 1.25, caution: 0.9, greed: 1.25 },
    { en: 'The Opportunist: strikes where the loot is', es: 'El Oportunista: golpea donde hay botín' },
  ),
  general(
    5,
    'dubois',
    'Dubois',
    { aggression: 1.4, caution: 0.5, greed: 1 },
    { en: 'The Bold: takes risks to win fast', es: 'El Audaz: arriesga para ganar rápido' },
  ),
];

export default generals;

import { Style } from './evaluate';

export interface General {
  id: string;
  name: string;
  style: Style;
}

/** The AI opponents. Their temperament shapes which plans they favour. */
export const GENERALS: General[] = [
  { id: 'kruger', name: 'Kruger', style: { aggression: 1.6, caution: 0.7, greed: 0.8 } },
  { id: 'vega', name: 'Vega', style: { aggression: 0.8, caution: 1.1, greed: 1.5 } },
  { id: 'okoye', name: 'Okoye', style: { aggression: 1, caution: 1, greed: 1 } },
  { id: 'ivanova', name: 'Ivanova', style: { aggression: 0.7, caution: 1.6, greed: 1.1 } },
  { id: 'tanaka', name: 'Tanaka', style: { aggression: 1.25, caution: 0.9, greed: 1.25 } },
  { id: 'dubois', name: 'Dubois', style: { aggression: 1.4, caution: 0.5, greed: 1 } },
];

export const generalById = (id: string | undefined) => GENERALS.find((g) => g.id === id) ?? GENERALS[2];

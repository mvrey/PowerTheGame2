import { distance, travelTime } from '../engine/rules';
import { Fleet, NEUTRAL, Planet } from '../engine/types';
import { PublicState } from './view';

type State = Pick<PublicState, 'planets' | 'fleets'>;

export const myPlanets = (state: State, me: number): Planet[] => state.planets.filter((p) => p.owner === me);
export const enemyPlanets = (state: State, me: number): Planet[] =>
  state.planets.filter((p) => p.owner !== me && p.owner !== NEUTRAL);
export const neutralPlanets = (state: State): Planet[] => state.planets.filter((p) => p.owner === NEUTRAL);
export const otherPlanets = (state: State, me: number): Planet[] => state.planets.filter((p) => p.owner !== me);

/** Fleets on their way to a planet. */
export const fleetsTo = (state: State, planet: number): Fleet[] => state.fleets.filter((f) => f.to === planet);

/** Turns from one planet to another. */
export const turnsBetween = (state: State, a: number, b: number): number =>
  travelTime(state.planets[a], state.planets[b]);

/** KDE's distance between two planets. */
export const distanceBetween = (state: State, a: number, b: number): number =>
  distance(state.planets[a], state.planets[b]);

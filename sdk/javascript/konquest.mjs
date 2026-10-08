// Helpers for Konquest bots in JavaScript (Node, ES modules). No dependencies; copy this file next
// to your bot.
//
// Everything here is a convenience over the JSON described in Docs/Games/Konquest.md: the galaxy's
// size and rules come in `hello.info`, the planets and fleets in every turn's observation.

/** `owner` of a planet nobody holds. */
export const NEUTRAL = -1;

/** KDE's distance between two planets: half the straight line between their sectors. */
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / 2;

/** Turns a fleet takes from planet a to planet b: it lands at the end of its last turn. */
export const travelTime = (a, b) => Math.max(1, Math.ceil(distance(a, b)));

export const myPlanets = (observation) => observation.state.planets.filter((p) => p.owner === observation.you);

/** Every planet that is not yours: enemy and neutral. */
export const otherPlanets = (observation) => observation.state.planets.filter((p) => p.owner !== observation.you);

export const enemyPlanets = (observation) =>
  observation.state.planets.filter((p) => p.owner !== observation.you && p.owner !== NEUTRAL);

/** Fleets (anyone's) on their way to a planet. */
export const fleetsTo = (observation, planetId) => observation.state.fleets.filter((f) => f.to === planetId);

/** Ships a planet adds each turn: its production if someone holds it, the neutral rate if not. */
export const growth = (observation, planet) =>
  planet.owner === NEUTRAL ? observation.state.rules.neutralProduction : planet.production;

/**
 * An order: `ships` ships from your planet `from` to planet `to` (ids). Return a list of them:
 * { orders: [send(...), send(...)] }. Each order may only use what its planet has left.
 */
export const send = (from, to, ships) => ({ from, to, ships });

// The public API of the Konquest engine. Built-in bots, the browser game, the jam's game module
// and the viewer import from here and nowhere else in the engine; see ARCHITECTURE.md.

// ---- Game data and rules
export type {
  DeepReadonly,
  EndReason,
  Fleet,
  FleetOrder,
  GameState,
  OrderError,
  Planet,
  Player,
  PlayerStats,
  ReadonlyGameState,
  Rules,
  TurnEvent,
} from '../engine/types';
export {
  DEFAULT_RULES,
  HOME_KILL,
  HOME_PRODUCTION,
  NEUTRAL,
  NEUTRAL_KILL_MIN,
  NEUTRAL_KILL_RANGE,
  NEUTRAL_PRODUCTION_MIN,
  NEUTRAL_PRODUCTION_RANGE,
  ORDER_ERRORS,
} from '../engine/types';
export type { ResolveOptions } from '../engine/rules';
export {
  checkOrders,
  cloneState,
  distance,
  isOut,
  orderError,
  planetsOf,
  productionOf,
  resolveTurn,
  shipsOf,
  travelTime,
} from '../engine/rules';

// ---- Galaxies
export type { GalaxyDef, NewGame } from '../engine/galaxy';
export {
  GALAXIES,
  MAX_PLAYERS,
  MAX_SIZE,
  MIN_PLAYERS,
  MIN_SIZE,
  createGame,
  galaxyById,
  planetName,
} from '../engine/galaxy';

// ---- Playing
export type { PlayerView, PublicState } from './view';
export { createView, publicState } from './view';
export { simulate } from './simulate';
export {
  distanceBetween,
  enemyPlanets,
  fleetsTo,
  myPlanets,
  neutralPlanets,
  otherPlanets,
  turnsBetween,
} from './queries';
export type { TurnReport } from './match';
export { Match } from './match';
export type { HeadlessOptions } from './headless';
export { decide, runHeadless } from './headless';

// ---- Bots
export type { Bot, BotContext, BotDefinition, BotLevel, BotOptions, Localized, Rng } from './bot';
export { BOT_LEVELS, BotRegistry, defineBot, definitionsIn, isBotLevel, localize, seatRng, timeSlicer } from './bot';
export { makeRng, randomSeed } from '../../../platform/core/random';

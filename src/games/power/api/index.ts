// The public API of the Power engine. Built-in bots, the browser game, the jam's game module and
// the viewer import from here
// and nowhere else in the engine; see ARCHITECTURE.md and BOTS.md.

// ---- Game data and rules constants
export type {
  Army,
  DeepReadonly,
  GameState,
  Mode,
  Order,
  OrderError,
  Piece,
  PieceDef,
  PieceType,
  Player,
  PlayerStats,
  ReadonlyGameState,
  ReadonlyPiece,
  RoundEvent,
  Snapshot,
  Strike,
} from '../engine/types';
export {
  GROUP1,
  MERC,
  MISSILE_COST,
  MODES,
  NO_ORIGIN,
  ORDERS_PER_ARMY,
  ORDER_ERRORS,
  PIECES,
  PIECE_TYPES,
  isMode,
  orderTimeMinutes,
} from '../engine/types';

// ---- Maps and boards
export type { Board, BoardNode, ByClass, MoveClass, NodeKind } from '../engine/board';
export {
  ARMY_IDS,
  ARMY_KEYS,
  ARMY_LETTERS,
  DEFAULT_MAP,
  MOVE_RANGE,
  NUM_ARMIES,
  RESERVE,
  boardOf,
  getBoard,
} from '../engine/board';
export type { MapDef } from '../engine/maps';
export { MAPS, mapById } from '../engine/maps';

// ---- Read-only queries on a state
export type { GameConfig, PlayerConfig } from '../engine/game';
export {
  armyStrength,
  cloneState,
  defaultSeating,
  livingArmies,
  mayCommand,
  orderAllowance,
  piecesPower,
  playerFlags,
  playerStrength,
  reserveOf,
  seatOrder,
  snapshot,
  teamOf,
} from '../engine/game';
export { executionOrder } from '../engine/resolve';
export { canonicalOrder, cheapestMissileSpend, isWellFormed, spendValue } from '../engine/rules';
export { enemyPowerAt, piecesAt, powerByTeam, powerOf } from './queries';

// ---- Planning toolkit
export type { PlayerView } from './view';
export { createView } from './view';
export type { OrderProblem } from './orderSheet';
export { OrderSheet, checkOrders } from './orderSheet';
export { legalOrders } from './legal';
export type { SimulateOptions, SimulationResult } from './simulate';
export { simulate } from './simulate';

// ---- Bots
export type { Bot, BotContext, BotDefinition, BotLevel, BotOptions, Localized, Rng } from './bot';
export { BOT_LEVELS, defineBot, isBotLevel, localize } from './bot';
export { BotRegistry, definitionsIn } from '../../../platform/core/botkit';
export type { TurnOptions, TurnProblem } from './driver';
export { playMatch, playTurn, timeSlicer } from './driver';
export { makeRng, randomSeed, seatRng } from './random';
export type { HeadlessOptions } from './headless';
export { runHeadless } from './headless';

// ---- Matches and clients
export type { MatchResolveOptions, MatchStatus, RoundReport, SubmitResult } from './match';
export { Match } from './match';
export type { GameClient } from './client';
export { LocalGameClient, movedPast } from './client';

// ---- Boards as JSON, for bots in other languages
export type { BoardInfo } from './boardInfo';
export { boardInfo } from './boardInfo';

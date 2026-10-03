// The public API of the Power engine. Bots, the UI, the server and the tools import from here
// and nowhere else in the engine; see ARCHITECTURE.md and BOTS.md.

// ---- Game data and rules constants
export type {
  Army, GameState, Order, OrderError, Piece, PieceDef, PieceType, Player, PlayerStats, RoundEvent, Snapshot, Strike,
} from '../engine/types';
export { GROUP1, MERC, MISSILE_COST, NO_ORIGIN, ORDERS_PER_ARMY, PIECES, PIECE_TYPES } from '../engine/types';

// ---- Maps and boards
export type { Board, BoardNode, ByClass, MoveClass, NodeKind } from '../engine/board';
export { ARMY_KEYS, ARMY_LETTERS, DEFAULT_MAP, NUM_ARMIES, RESERVE, boardOf, getBoard } from '../engine/board';
export type { MapDef } from '../engine/maps';
export { MAPS, mapById } from '../engine/maps';

// ---- Read-only queries on a state
export type { GameConfig, PlayerConfig } from '../engine/game';
export {
  armyStrength, cloneState, livingArmies, mayCommand, playerFlags, playerStrength, reserveOf, seatOrder, snapshot, teamOf,
} from '../engine/game';
export { executionOrder } from '../engine/resolve';
export { cheapestMissileSpend, isWellFormed, spendValue } from '../engine/rules';
export { enemyPowerAt, piecesAt, powerByTeam, powerOf } from './queries';

// ---- Planning toolkit
export type { PlayerView } from './view';
export { OrderSheet } from './orderSheet';
export { legalOrders } from './legal';
export type { OrderProblem, SimulateOptions, SimulationResult } from './simulate';
export { checkOrders, simulate } from './simulate';

// ---- Bots
export type { Bot, BotContext, BotDefinition, BotLevel, BotOptions, Localized, Rng } from './bot';
export { defineBot, localize } from './bot';
export type { TurnOptions, TurnProblem } from './driver';
export { makeRng, playMatch, playTurn, randomSeed, timeSlicer } from './driver';
export type { HeadlessOptions } from './headless';
export { runHeadless } from './headless';

// ---- Matches and clients
export type { MatchResolveOptions, MatchStatus, RoundReport, SubmitResult } from './match';
export { Match } from './match';
export type { GameClient } from './client';
export { LocalGameClient, movedPast } from './client';
export { ApiError, HttpGameClient, createRemoteMatch } from './httpClient';
export type {
  BoardInfo, BotInfo, CreateMatchRequest, CreateMatchResponse, MatchSummary, SeatInfo, SeatRequest,
} from './protocol';
export { boardInfo } from './protocol';

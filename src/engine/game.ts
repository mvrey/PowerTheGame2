import { ARMY_IDS, NUM_ARMIES, RESERVE, getBoard } from './board';
import { mapById } from './maps';
import {
  GameState,
  MERC,
  Mode,
  NO_ORIGIN,
  ORDERS_PER_ARMY,
  Order,
  Piece,
  PieceType,
  PIECES,
  Player,
  ReadonlyGameState,
  ReadonlyPiece,
  Snapshot,
} from './types';

export interface PlayerConfig {
  name: string;
  armies: number[];
}

export interface GameConfig {
  /** Map id; the classic board when omitted. */
  map?: string;
  mode: Mode;
  players: PlayerConfig[];
}

const START: PieceType[] = ['S', 'S', 'T', 'T', 'F', 'F', 'D', 'D'];

export function newGame(config: GameConfig): GameState {
  const map = mapById(config.map).id;
  const board = getBoard(map);
  const state: GameState = {
    map,
    mode: config.mode,
    round: 1,
    referee: 0,
    armies: [],
    players: config.players.map((p, id): Player => ({
      id,
      name: p.name,
      armies: [...p.armies].sort((a, b) => a - b),
      alive: true,
      stats: { captured: 0, lost: 0, battlesWon: 0, flags: 0, missiles: 0, income: 0 },
    })),
    pieces: [],
    nextId: 1,
    strikes: [],
    over: false,
    winners: [],
    endReason: null,
  };
  for (const a of ARMY_IDS) {
    const owner = state.players.find((p) => p.armies.includes(a));
    state.armies.push({ id: a, controller: owner ? owner.id : MERC, alive: true, power: 0, flags: [a] });
    for (const type of START) addPiece(state, type, a, board.hq[a]);
  }
  state.referee = seatOrder(state)[0];
  return state;
}

/**
 * The usual armies of each seat: one army each, or two neighbouring allied armies each in a
 * two-player game. Seat 0 starts at `firstArmy`; the other seats follow clockwise.
 */
export function defaultSeating(mode: Mode, firstArmy = 0): number[][] {
  const army = (offset: number) => (firstArmy + offset) % NUM_ARMIES;
  if (mode === 2)
    return [
      [army(0), army(1)],
      [army(2), army(3)],
    ];
  return Array.from({ length: mode }, (_, seat) => [army(seat)]);
}

export function addPiece(state: GameState, type: PieceType, army: number, loc: number): Piece {
  const piece: Piece = {
    id: state.nextId++,
    type,
    army,
    loc,
    moved: false,
    fresh: false,
    from: NO_ORIGIN,
    bounced: false,
  };
  state.pieces.push(piece);
  return piece;
}

export function cloneState(state: ReadonlyGameState): GameState {
  return {
    ...state,
    armies: state.armies.map((a) => ({ ...a, flags: [...a.flags] })),
    players: state.players.map((p) => ({ ...p, armies: [...p.armies], stats: { ...p.stats } })),
    pieces: state.pieces.map((p) => ({ ...p })),
    strikes: state.strikes.map((s) => ({ ...s })),
    winners: [...state.winners],
  };
}

export function snapshot(state: ReadonlyGameState): Snapshot {
  return {
    pieces: state.pieces.map((p) => ({ id: p.id, type: p.type, army: p.army, loc: p.loc })),
    power: state.armies.map((a) => a.power),
    alive: state.armies.map((a) => a.alive),
    flags: state.armies.map((a) => [...a.flags]),
  };
}

/** Team of an army: its controlling player, or MERC. Allied armies share a team. */
export function teamOf(state: ReadonlyGameState, army: number): number {
  return state.armies[army].controller;
}

/** Living players in clockwise seat order. */
export function seatOrder(state: ReadonlyGameState): number[] {
  const seen: number[] = [];
  for (const army of state.armies) {
    const c = army.controller;
    if (c !== MERC && state.players[c].alive && !seen.includes(c)) seen.push(c);
  }
  return seen;
}

/** Living armies a player controls. */
export function livingArmies(state: ReadonlyGameState, player: number): number[] {
  return state.players[player].armies.filter((a) => state.armies[a].alive);
}

export function mayCommand(state: ReadonlyGameState, player: number, army: number): boolean {
  const c = state.armies[army]?.controller;
  return c === player || c === MERC;
}

/** Orders a player may give in a round: ORDERS_PER_ARMY for each of their living armies. */
export function orderAllowance(state: ReadonlyGameState, player: number): number {
  return livingArmies(state, player).length * ORDERS_PER_ARMY;
}

/** Whether `order` fits in the player's remaining order allowance given `prior` orders. */
export function withinBudget(state: ReadonlyGameState, player: number, prior: readonly Order[], order: Order): boolean {
  if (prior.length >= orderAllowance(state, player)) return false;
  if (state.armies[order.army]?.controller === MERC) return true;
  return prior.filter((o) => o.army === order.army).length < ORDERS_PER_ARMY;
}

export function ordersLeft(state: ReadonlyGameState, player: number, prior: readonly Order[], army: number): number {
  const total = orderAllowance(state, player) - prior.length;
  if (state.armies[army].controller === MERC) return Math.max(0, total);
  return Math.max(0, Math.min(total, ORDERS_PER_ARMY - prior.filter((o) => o.army === army).length));
}

/** Combat power of an army's pieces, wherever they stand. */
export function piecesPower(pieces: readonly { type: PieceType; army: number }[], army: number): number {
  let total = 0;
  for (const p of pieces) if (p.army === army) total += PIECES[p.type].power;
  return total;
}

/** Combat strength of an army: pieces on the board and in the Reserve plus Power units. */
export function armyStrength(state: ReadonlyGameState, army: number): number {
  return state.armies[army].power + piecesPower(state.pieces, army);
}

export function playerStrength(state: ReadonlyGameState, player: number): number {
  return state.players[player].armies.reduce(
    (sum, a) => sum + (state.armies[a].controller === player ? armyStrength(state, a) : 0),
    0,
  );
}

export function playerFlags(state: ReadonlyGameState, player: number): number {
  return state.players[player].armies.reduce(
    (sum, a) => sum + (state.armies[a].alive ? state.armies[a].flags.length : 0),
    0,
  );
}

export function reserveOf(state: ReadonlyGameState, army: number): ReadonlyPiece[] {
  return state.pieces.filter((p) => p.army === army && p.loc === RESERVE);
}

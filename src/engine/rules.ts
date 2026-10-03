import { NUM_ARMIES, RESERVE, boardOf } from './board';
import { addPiece, mayCommand } from './game';
import { GameState, MISSILE_COST, NO_ORIGIN, Order, OrderError, Piece, PieceType, PIECES } from './types';

function findMovable(state: GameState, army: number, type: PieceType, from: number): Piece | undefined {
  return state.pieces.find((p) => p.army === army && p.type === type && p.loc === from && !p.moved && !p.fresh);
}

function at(state: GameState, army: number, type: PieceType, loc: number): Piece[] {
  // Pieces that already moved are spent first, keeping unmoved ones free for later orders.
  return state.pieces
    .filter((p) => p.army === army && p.type === type && p.loc === loc)
    .sort((a, b) => Number(b.moved) - Number(a.moved));
}

export function spendValue(spend: Partial<Record<PieceType, number>>, power: number): number {
  let total = power;
  for (const [type, n] of Object.entries(spend)) total += PIECES[type as PieceType].power * (n ?? 0);
  return total;
}

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isType = (v: unknown): v is PieceType => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PIECES, v);

/** Whether a value has the shape of an order. Orders may come from untrusted sources (bots over HTTP). */
export function isWellFormed(order: unknown): order is Order {
  if (typeof order !== 'object' || order === null) return false;
  const o = order as Record<string, unknown>;
  if (!isInt(o.army)) return false;
  switch (o.k) {
    case 'move': return isType(o.type) && isInt(o.from) && isInt(o.to);
    case 'buy': return isType(o.type);
    case 'up': return isType(o.type) && isInt(o.at);
    case 'mk':
      return isInt(o.at) && isInt(o.power) && typeof o.spend === 'object' && o.spend !== null
        && Object.entries(o.spend).every(([type, n]) => isType(type) && (n === undefined || isInt(n)));
    case 'launch': return isInt(o.from) && isInt(o.target) && isInt(o.targetArmy);
    default: return false;
  }
}

/** Returns null when `order` is legal for `player` in `state`. */
export function checkOrder(state: GameState, player: number, order: Order): OrderError | null {
  if (!isWellFormed(order)) return 'malformed';
  const army = state.armies[order.army];
  const board = boardOf(state);
  if (!army || !army.alive) return 'dead';
  if (!mayCommand(state, player, order.army)) return 'notYours';
  switch (order.k) {
    case 'move': {
      const def = PIECES[order.type];
      if (!def.cls) return 'cantMove';
      if (!findMovable(state, order.army, order.type, order.from)) {
        return state.pieces.some((p) => p.army === order.army && p.type === order.type && p.loc === order.from)
          ? 'cantMove' : 'noPiece';
      }
      if (order.from === RESERVE) return order.to === board.hq[order.army] ? null : 'onlyHQ';
      if (order.to < 0 || order.to >= board.numNodes) return 'unreachable';
      return board.canReach(def.cls, order.from, order.to) ? null : 'unreachable';
    }
    case 'buy':
      if (PIECES[order.type].group !== 1) return 'badType';
      return army.power >= PIECES[order.type].power ? null : 'noPower';
    case 'up':
      if (PIECES[order.type].group !== 1) return 'badType';
      return at(state, order.army, order.type, order.at).length >= 3 ? null : 'needThree';
    case 'mk': {
      if (order.power < 0 || (order.power > 0 && order.at !== RESERVE)) return 'badSpend';
      if (order.power > army.power) return 'noPower';
      for (const [type, n] of Object.entries(order.spend)) {
        const count = n ?? 0;
        if (count < 0 || type === 'M') return 'badSpend';
        if (at(state, order.army, type as PieceType, order.at).length < count) return 'noPiece';
      }
      return spendValue(order.spend, order.power) >= MISSILE_COST ? null : 'tooWeak';
    }
    case 'launch': {
      if (!state.pieces.some((p) => p.army === order.army && p.type === 'M' && p.loc === order.from)) return 'noMissile';
      if (order.target === RESERVE) {
        return order.targetArmy >= 0 && order.targetArmy < NUM_ARMIES && state.armies[order.targetArmy].alive
          ? null : 'badTarget';
      }
      return order.target >= 0 && order.target < board.numNodes ? null : 'badTarget';
    }
  }
}

function remove(state: GameState, gone: Piece[]): void {
  const ids = new Set(gone.map((p) => p.id));
  state.pieces = state.pieces.filter((p) => !ids.has(p.id));
}

/** Applies an order already validated with checkOrder. */
export function applyOrder(state: GameState, order: Order): void {
  const army = state.armies[order.army];
  switch (order.k) {
    case 'move': {
      const piece = findMovable(state, order.army, order.type, order.from)!;
      piece.from = order.from;
      piece.loc = order.to;
      piece.moved = true;
      break;
    }
    case 'buy':
      army.power -= PIECES[order.type].power;
      addPiece(state, order.type, order.army, RESERVE);
      break;
    case 'up': {
      remove(state, at(state, order.army, order.type, order.at).slice(0, 3));
      const big = addPiece(state, PIECES[order.type].up!, order.army, order.at);
      if (order.at !== RESERVE) markTraded(big);
      break;
    }
    case 'mk': {
      for (const [type, n] of Object.entries(order.spend))
        remove(state, at(state, order.army, type as PieceType, order.at).slice(0, n ?? 0));
      army.power -= order.power;
      const missile = addPiece(state, 'M', order.army, order.at);
      if (order.at !== RESERVE) markTraded(missile);
      break;
    }
    case 'launch': {
      const missile = state.pieces.find((p) => p.army === order.army && p.type === 'M' && p.loc === order.from)!;
      remove(state, [missile]);
      state.strikes.push({ army: order.army, target: order.target, targetArmy: order.targetArmy });
      break;
    }
  }
}

function markTraded(piece: Piece): void {
  piece.fresh = true;
  piece.from = NO_ORIGIN;
}

/**
 * Cheapest combination of an army's pieces (and Power units, in the Reserve) at `loc`
 * worth at least 100. Returns null when the location does not hold enough.
 */
export function cheapestMissileSpend(
  state: GameState, army: number, loc: number,
): { spend: Partial<Record<PieceType, number>>; power: number; total: number } | null {
  const items: { type: PieceType | 'P'; value: number }[] = [];
  for (const p of state.pieces)
    if (p.army === army && p.loc === loc && p.type !== 'M') items.push({ type: p.type, value: PIECES[p.type].power });
  if (loc === RESERVE) for (let i = 0; i < state.armies[army].power; i++) items.push({ type: 'P', value: 1 });
  const sum = items.reduce((s, i) => s + i.value, 0);
  if (sum < MISSILE_COST) return null;
  // Subset-sum over achievable totals, minimising the overshoot above 100.
  const best: (number[] | undefined)[] = [[]];
  items.forEach((item, idx) => {
    for (let t = sum - item.value; t >= 0; t--)
      if (best[t] && !best[t + item.value] && t < MISSILE_COST) best[t + item.value] = [...best[t]!, idx];
  });
  let total = MISSILE_COST;
  while (!best[total]) total++;
  const spend: Partial<Record<PieceType, number>> = {};
  let power = 0;
  for (const idx of best[total]!) {
    const type = items[idx].type;
    if (type === 'P') power++;
    else spend[type] = (spend[type] ?? 0) + 1;
  }
  return { spend, power, total };
}

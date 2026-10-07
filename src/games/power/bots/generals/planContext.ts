import {
  Board,
  MERC,
  Order,
  OrderSheet,
  PIECES,
  RESERVE,
  ReadonlyGameState,
  ReadonlyPiece,
  Rng,
  boardOf,
  livingArmies,
} from '../../api';
import { Analysis, VALUE, hostile } from './analysis';
import { Style } from './evaluate';
import { pick } from './random';

/** What a plan is built from: the position, whose plan it is and what it is after. */
export interface PlanContext {
  state: ReadonlyGameState;
  board: Board;
  me: number;
  /** My side in the analysis tables. */
  side: number;
  analysis: Analysis;
  style: Style;
  rng: Rng;
  /** My living armies. */
  armies: number[];
  /** Enemy army this plan marches on. */
  objective: number;
}

/** A fresh context for one plan of `me`, with an objective drawn at random; null once `me` is out. */
export function createPlanContext(
  state: ReadonlyGameState,
  analysis: Analysis,
  me: number,
  style: Style,
  rng: Rng,
): PlanContext | null {
  const armies = livingArmies(state, me);
  if (!armies.length) return null;
  const board = boardOf(state);
  const enemies = state.armies.filter((a) => a.alive && a.controller !== me && a.controller !== MERC);
  const objective = pick(rng, enemies, (enemy) => {
    // Favour weak neighbours.
    let strength = enemy.power + 10;
    for (const p of state.pieces) if (p.army === enemy.id) strength += VALUE[p.type];
    const distance = Math.min(...armies.map((a) => board.rounds.air[board.hq[a]][board.hq[enemy.id]]));
    return 1000 / (strength * distance);
  });
  return {
    state,
    board,
    me,
    side: me + 1,
    analysis,
    style,
    rng,
    armies,
    objective: objective ? objective.id : armies[0],
  };
}

export const piecePower = (p: ReadonlyPiece) => PIECES[p.type].power;
export const strongestFirst = (x: ReadonlyPiece, y: ReadonlyPiece) => piecePower(y) - piecePower(x);
export const isInfantry = (p: ReadonlyPiece) => PIECES[p.type].cls === 'inf';
export const moveOrder = (p: ReadonlyPiece, to: number): Order => ({
  kind: 'move',
  army: p.army,
  type: p.type,
  from: p.loc,
  to,
});

export function isMine(ctx: PlanContext, p: ReadonlyPiece): boolean {
  return ctx.state.armies[p.army].controller === ctx.me;
}

/** My power on a node once the orders so far are carried out. */
export function myPowerAt(ctx: PlanContext, sheet: OrderSheet, node: number): number {
  let total = 0;
  for (const p of sheet.preview.pieces) if (p.loc === node && isMine(ctx, p)) total += piecePower(p);
  return total;
}

/** My pieces on the board that can still be given a move order. */
export function movablePieces(ctx: PlanContext, sheet: OrderSheet): ReadonlyPiece[] {
  return sheet.preview.pieces.filter(
    (p) => p.loc !== RESERVE && isMine(ctx, p) && !p.moved && !p.fresh && PIECES[p.type].cls && sheet.left(p.army) > 0,
  );
}

export function canReach(ctx: PlanContext, p: ReadonlyPiece, to: number): boolean {
  return ctx.board.canReach(PIECES[p.type].cls!, p.loc, to);
}

/** What `piece` would face after moving to `to`, judged by what stands around now. */
export interface Destination {
  /** My power there, the piece included. */
  strength: number;
  /** Someone already there is at least as strong: the move would be lost or bounce. */
  outmatched: boolean;
  /** Nobody could bring more power there next round. */
  safe: boolean;
}

export function assessDestination(ctx: PlanContext, sheet: OrderSheet, piece: ReadonlyPiece, to: number): Destination {
  const strength = piecePower(piece) + myPowerAt(ctx, sheet, to);
  const { analysis } = ctx;
  return {
    strength,
    outmatched: hostile(analysis, analysis.power, to, ctx.side) >= strength,
    safe: hostile(analysis, analysis.potential, to, ctx.side) <= strength,
  };
}

/** Whether a node is the HQ of one of my armies. */
export function isMyHQ(ctx: PlanContext, node: number): boolean {
  const info = ctx.board.nodes[node];
  return info.kind === 'hq' && ctx.armies.includes(info.army);
}

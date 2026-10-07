import { GROUP1, MERC, Order, OrderSheet, PIECES, PieceType, RESERVE } from '../../../api';
import { VALUE } from '../analysis';
import {
  assessDestination,
  canReach,
  isMine,
  movablePieces,
  moveOrder,
  myPowerAt,
  piecePower,
  strongestFirst,
} from '../planContext';
import { bestBy, pick, shuffled } from '../random';
import { Tactic } from './tactic';

/** Put a piece on an enemy territory to collect Power. */
export const income: Tactic = (ctx, sheet) => {
  const { nodes } = ctx.board;
  const targets = shuffled(
    ctx.rng,
    ctx.state.armies.filter((a) => a.alive && a.controller !== ctx.me).map((a) => a.id),
  );
  const free = movablePieces(ctx, sheet);
  for (const target of targets) {
    const alreadyThere = sheet.preview.pieces.some(
      (p) => isMine(ctx, p) && p.loc !== RESERVE && nodes[p.loc].kind === 'sector' && nodes[p.loc].army === target,
    );
    if (alreadyThere) continue;
    const moves = free.flatMap((p) => ctx.board.territory[target].map((to) => ({ p, to })));
    const best = bestBy(moves, ({ p, to }) => {
      if (!canReach(ctx, p, to)) return null;
      const spot = assessDestination(ctx, sheet, p, to);
      if (spot.outmatched) return null;
      return (spot.safe ? 10 : 0) - VALUE[p.type] * 0.3 + ctx.rng() * 2;
    });
    if (best && sheet.add(moveOrder(best.p, best.to))) return true;
  }
  return false;
};

/** Trade up, spend Power and bring the Reserve onto the board. */
export const develop: Tactic = (ctx, sheet) => {
  let budget = 1 + Math.floor(ctx.rng() * 5);
  let added = false;
  const add = (order: Order) => {
    if (budget <= 0 || !sheet.add(order)) return false;
    budget--;
    added = true;
    return true;
  };
  const count = (army: number, type: PieceType, loc: number) => countAt(sheet, army, type, loc);
  const tradeUps = (army: number) => {
    const spots = new Set(sheet.preview.pieces.filter((p) => p.army === army).map((p) => p.loc));
    for (const at of spots)
      for (const type of GROUP1) while (count(army, type, at) >= 3 && add({ kind: 'tradeUp', army, type, at }));
  };
  for (const army of shuffled(ctx.rng, ctx.armies)) {
    const hq = ctx.board.hq[army];
    const power = () => sheet.preview.armies[army].power;
    tradeUps(army);
    while (budget > 0 && power() >= 2 && sheet.left(army) > 0) {
      // Buying the third of a kind sets up a trade-up.
      const completesThree = (t: PieceType) => count(army, t, RESERVE) % 3 === 2 || count(army, t, hq) === 2;
      const type = pick(
        ctx.rng,
        GROUP1.filter((t) => PIECES[t].power <= power()),
        (t) => (t === 'S' || t === 'T' ? 3 + (completesThree(t) ? 4 : 0) : t === 'F' ? 1.5 : 2),
      )!;
      if (!add({ kind: 'buy', army, type })) break;
      tradeUps(army);
    }
    const waiting = sheet.preview.pieces
      .filter((p) => p.army === army && p.loc === RESERVE && PIECES[p.type].cls)
      .sort(strongestFirst);
    for (const p of waiting) {
      // Two of a kind may be worth holding back until a third can be bought.
      if (PIECES[p.type].group === 1 && count(army, p.type, RESERVE) === 2 && ctx.rng() < 0.6) continue;
      if (!add(moveOrder(p, hq))) break;
    }
    tradeUps(army);
  }
  return added;
};

/** Bring a third piece to a pair and trade the three up. */
export const gather: Tactic = (ctx, sheet) => {
  const free = movablePieces(ctx, sheet);
  for (const army of shuffled(ctx.rng, ctx.armies)) {
    for (const type of shuffled(ctx.rng, GROUP1)) {
      const onNode = new Map<number, number>();
      for (const p of sheet.preview.pieces)
        if (p.army === army && p.type === type && p.loc !== RESERVE) onNode.set(p.loc, (onNode.get(p.loc) ?? 0) + 1);
      for (const [node, n] of onNode) {
        if (n !== 2 || sheet.left(army) < 2) continue;
        const third = free.find((p) => p.army === army && p.type === type && p.loc !== node && canReach(ctx, p, node));
        if (third && sheet.add(moveOrder(third, node))) {
          sheet.add({ kind: 'tradeUp', army, type, at: node });
          return true;
        }
      }
    }
  }
  return false;
};

/** Three-player game: walk a mercenary piece into one of my stronger stacks to capture it. */
export const hireMercenary: Tactic = (ctx, sheet) => {
  const { analysis } = ctx;
  const mercenaries = sheet.preview.pieces.filter(
    (p) =>
      ctx.state.armies[p.army].controller === MERC && p.loc !== RESERVE && !p.moved && !p.fresh && PIECES[p.type].cls,
  );
  const moves = mercenaries.flatMap((p) => ctx.board.reach[PIECES[p.type].cls!][p.loc].map((to) => ({ p, to })));
  const best = bestBy(moves, ({ p, to }) => {
    const mineThere = myPowerAt(ctx, sheet, to);
    if (!mineThere) return null;
    // The piece fights for whoever ends up strongest there, itself included on the mercenary side.
    let others = piecePower(p);
    for (let side = 0; side < analysis.sides; side++)
      if (side !== ctx.side) others = Math.max(others, analysis.power[to][side] + (side === 0 ? piecePower(p) : 0));
    if (mineThere <= others) return null;
    return VALUE[p.type] + ctx.rng();
  });
  return !!best && sheet.add(moveOrder(best.p, best.to));
};

function countAt(sheet: OrderSheet, army: number, type: PieceType, loc: number): number {
  return sheet.preview.pieces.filter((p) => p.army === army && p.type === type && p.loc === loc).length;
}

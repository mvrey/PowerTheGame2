import { GROUP1, OrderSheet, PIECES, RESERVE } from '../../../api';
import { hostile } from '../analysis';
import { PlanContext, movablePieces, moveOrder, myPowerAt, piecePower } from '../planContext';
import { pick, shuffled } from '../random';

/** Adds one legal order at all, so the plan is never empty: an empty plan costs a Power. */
export function fallback(ctx: PlanContext, sheet: OrderSheet): void {
  for (const p of shuffled(ctx.rng, movablePieces(ctx, sheet))) {
    const options = ctx.board.reach[PIECES[p.type].cls!][p.loc].filter(
      (to) => hostile(ctx.analysis, ctx.analysis.power, to, ctx.side) < piecePower(p) + myPowerAt(ctx, sheet, to),
    );
    const to = pick(ctx.rng, options, () => 1);
    if (to !== undefined && sheet.add(moveOrder(p, to))) return;
  }
  for (const army of ctx.armies) {
    for (const p of sheet.preview.pieces)
      if (p.army === army && p.loc === RESERVE && PIECES[p.type].cls && sheet.add(moveOrder(p, ctx.board.hq[army])))
        return;
    for (const type of GROUP1) if (sheet.add({ kind: 'buy', army, type })) return;
    for (const type of GROUP1)
      for (const at of new Set(sheet.preview.pieces.filter((p) => p.army === army).map((p) => p.loc)))
        if (sheet.add({ kind: 'tradeUp', army, type, at })) return;
  }
  for (const p of movablePieces(ctx, sheet))
    for (const to of ctx.board.reach[PIECES[p.type].cls!][p.loc]) if (sheet.add(moveOrder(p, to))) return;
}

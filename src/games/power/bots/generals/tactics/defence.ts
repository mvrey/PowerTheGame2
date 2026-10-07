import { GROUP1, PIECES, RESERVE } from '../../../api';
import { VALUE, hostile } from '../analysis';
import {
  assessDestination,
  canReach,
  isMine,
  isMyHQ,
  movablePieces,
  moveOrder,
  myPowerAt,
  strongestFirst,
} from '../planContext';
import { bestBy } from '../random';
import { Tactic } from './tactic';

const STRONGEST_PURCHASE_FIRST = [...GROUP1].reverse();

/** Reinforce a threatened HQ from the Reserve, from nearby pieces or by buying. */
export const defend: Tactic = (ctx, sheet) => {
  let added = false;
  for (const army of ctx.armies) {
    const hq = ctx.board.hq[army];
    const threat = hostile(ctx.analysis, ctx.analysis.potential, hq, ctx.side, true);
    if (!threat) continue;
    const goal = threat * (ctx.rng() < 0.5 ? 1 : 0.6);
    let have = myPowerAt(ctx, sheet, hq);
    if (have > goal) continue;
    const helpers = sheet.preview.pieces
      .filter(
        (p) =>
          isMine(ctx, p) &&
          !p.moved &&
          !p.fresh &&
          PIECES[p.type].cls &&
          (p.loc === RESERVE ? p.army === army : p.loc !== hq && canReach(ctx, p, hq)),
      )
      .sort(strongestFirst);
    for (const p of helpers) {
      if (have > goal) break;
      if (sheet.add(moveOrder(p, hq))) {
        have += PIECES[p.type].power;
        added = true;
      }
    }
    const power = () => sheet.preview.armies[army].power;
    while (have <= goal && power() >= 2 && sheet.left(army) >= 2) {
      const type = STRONGEST_PURCHASE_FIRST.find((t) => PIECES[t].power <= power())!;
      if (!sheet.add({ kind: 'buy', army, type }) || !sheet.add({ kind: 'move', army, type, from: RESERVE, to: hq }))
        break;
      have += PIECES[type].power;
      added = true;
    }
  }
  return added;
};

/** Pull valuable pieces out of spaces the enemy could overpower. */
export const retreat: Tactic = (ctx, sheet) => {
  let added = false;
  const mostValuableFirst = movablePieces(ctx, sheet).sort((x, y) => VALUE[y.type] - VALUE[x.type]);
  for (const p of mostValuableFirst) {
    if (isMyHQ(ctx, p.loc)) continue;
    if (hostile(ctx.analysis, ctx.analysis.potential, p.loc, ctx.side) <= myPowerAt(ctx, sheet, p.loc)) continue;
    const to = bestBy(ctx.board.reach[PIECES[p.type].cls!][p.loc], (to) => {
      const spot = assessDestination(ctx, sheet, p, to);
      if (!spot.safe) return null;
      return (isMyHQ(ctx, to) ? 4 : 0) + Math.min(spot.strength, 40) * 0.1 + ctx.rng() * 2;
    });
    if (to !== undefined && sheet.add(moveOrder(p, to))) {
      added = true;
      if (ctx.rng() < 0.5) break;
    }
  }
  return added;
};

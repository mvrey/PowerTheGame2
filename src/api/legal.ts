import { RESERVE, boardOf } from '../engine/board';
import { mayCommand } from '../engine/game';
import { cheapestMissileSpend } from '../engine/rules';
import { GROUP1, Order, PIECES } from '../engine/types';
import { OrderSheet } from './orderSheet';

/**
 * Every order that could be added to `sheet` right now.
 *
 * Megamissiles are built with the cheapest recipe at each place that can afford one, and every
 * missile may be launched at any space or at any living army's Reserve.
 */
export function legalOrders(sheet: OrderSheet): Order[] {
  const state = sheet.preview;
  const board = boardOf(state);
  const out: Order[] = [];
  const seen = new Set<string>();
  const offer = (order: Order) => {
    const key = JSON.stringify(order);
    if (seen.has(key)) return;
    seen.add(key);
    if (!sheet.check(order)) out.push(order);
  };

  for (const army of state.armies) {
    if (!army.alive || !mayCommand(state, sheet.player, army.id)) continue;
    const a = army.id;
    const places = new Set<number>([RESERVE]);
    for (const p of state.pieces) {
      if (p.army !== a) continue;
      places.add(p.loc);
      const cls = PIECES[p.type].cls;
      if (p.type === 'M') {
        for (let node = 0; node < board.numNodes; node++)
          offer({ kind: 'launch', army: a, from: p.loc, target: node, targetArmy: -1 });
        for (const t of state.armies)
          if (t.alive) offer({ kind: 'launch', army: a, from: p.loc, target: RESERVE, targetArmy: t.id });
      } else if (cls && !p.moved && !p.fresh) {
        const targets = p.loc === RESERVE ? [board.hq[a]] : board.reach[cls][p.loc];
        for (const to of targets) offer({ kind: 'move', army: a, type: p.type, from: p.loc, to });
      }
    }
    for (const type of GROUP1) offer({ kind: 'buy', army: a, type });
    for (const at of places) {
      for (const type of GROUP1) offer({ kind: 'tradeUp', army: a, type, at });
      const recipe = cheapestMissileSpend(state, a, at);
      if (recipe) offer({ kind: 'makeMissile', army: a, at, spend: recipe.spend, power: recipe.power });
    }
  }
  return out;
}

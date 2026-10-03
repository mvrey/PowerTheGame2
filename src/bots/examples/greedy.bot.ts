import {
  GameState, MERC, OrderSheet, PIECES, PlayerView, RESERVE, boardOf, defineBot, legalOrders, playerStrength, simulate,
} from '../../api';

// Example bot that looks one round ahead with the real rules. It adds orders one at a time,
// each time trying every legal order and keeping the one whose simulated outcome scores best.
// It assumes the rivals stand still, which makes it brave to the point of foolishness: a good
// place to start improving.

/** How good a position looks for `me`. */
function score(state: GameState, me: number): number {
  if (state.over) return state.winners.includes(me) ? 1e6 : -1e6;
  if (!state.players[me].alive) return -1e6;
  const board = boardOf(state);
  const rivals = state.players.filter((p) => p.id !== me);
  let value = playerStrength(state, me);
  value -= Math.max(0, ...rivals.filter((p) => p.alive).map((p) => playerStrength(state, p.id)));
  value += 200 * rivals.filter((p) => !p.alive).length;

  const enemyHQs = state.armies.filter((a) => a.alive && a.controller !== me && a.controller !== MERC).map((a) => board.hq[a.id]);
  for (const p of state.pieces) {
    if (p.loc === RESERVE || state.armies[p.army].controller !== me) continue;
    const node = board.nodes[p.loc];
    // Standing on enemy land pays Power every round.
    if (node.kind === 'sector' && state.armies[node.army].controller !== me) value += 4;
    // Infantry takes flags: reward walking it towards an enemy HQ.
    if (PIECES[p.type].cls === 'inf' && enemyHQs.length) {
      const closest = Math.min(...enemyHQs.map((hq) => board.rounds.inf[p.loc][hq]));
      value += Math.max(0, 8 - closest);
    }
  }
  return value;
}

function outcome(view: PlayerView, sheet: OrderSheet): number {
  const orders = view.state.players.map((p) => (p.id === view.me ? [...sheet.orders] : []));
  return score(simulate(view.state, orders).state, view.me);
}

export default defineBot({
  id: 'greedy',
  name: 'Greedy',
  description: { en: 'Example bot: one-round lookahead, ignores rivals', es: 'Bot de ejemplo: mira una ronda, ignora a los rivales' },
  levels: false,
  order: 51,
  create: () => ({
    async decide(view, ctx) {
      const sheet = new OrderSheet(view.state, view.me);
      let current = outcome(view, sheet);
      while (!sheet.full) {
        let best: { order: (typeof sheet.orders)[number]; value: number } | undefined;
        for (const order of legalOrders(sheet)) {
          const trial = new OrderSheet(view.state, view.me, [...sheet.orders, order]);
          const value = outcome(view, trial) + ctx.rng() * 0.01;
          if (!best || value > best.value) best = { order, value };
          await ctx.checkpoint();
        }
        // Stop once nothing helps, but never hand in an empty sheet: that costs a Power.
        if (!best || (best.value <= current && sheet.orders.length > 0)) break;
        sheet.add(best.order);
        current = best.value;
      }
      return [...sheet.orders];
    },
  }),
});

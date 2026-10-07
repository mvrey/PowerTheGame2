import {
  BotLevel,
  Order,
  OrderSheet,
  PlayerView,
  ReadonlyGameState,
  Rng,
  defineBot,
  legalOrders,
  playerStrength,
  simulate,
} from '../../api';

// A deliberately generic baseline: flat Monte Carlo search with a rough evaluation. It knows the
// rules (through the real simulator) and nothing about strategy. The jam's Design asks to check
// that such an off-the-shelf approach does not beat hand-written strategy: see
// Docs/Games/Power.md, "Is the game deep enough?".

/** Candidate plans sampled, and random rival replies each candidate is scored against. */
const BUDGET: Record<BotLevel, { plans: number; replies: number }> = {
  1: { plans: 12, replies: 2 },
  2: { plans: 40, replies: 4 },
  3: { plans: 120, replies: 6 },
};
const WIN = 10_000;

/** A random full plan: legal orders picked one at a time until the allowance is used. */
function randomPlan(state: ReadonlyGameState, player: number, rng: Rng): Order[] {
  const sheet = new OrderSheet(state, player);
  for (let i = 0; i < sheet.max && !sheet.full; i++) {
    const options = legalOrders(sheet);
    if (!options.length) break;
    sheet.add(options[Math.floor(rng() * options.length)]);
  }
  return [...sheet.orders];
}

/** Material lead over the strongest rival, or a win/loss. Nothing more. */
function evaluate(state: ReadonlyGameState, me: number): number {
  if (state.over) return state.winners.includes(me) ? WIN : -WIN;
  if (!state.players[me].alive) return -WIN;
  const rivals = state.players.filter((p) => p.id !== me && p.alive).map((p) => playerStrength(state, p.id));
  return playerStrength(state, me) - Math.max(0, ...rivals);
}

async function decide(view: PlayerView, rng: Rng, level: BotLevel, checkpoint: () => Promise<void>): Promise<Order[]> {
  const { state, me } = view;
  const rivals = state.players.filter((p) => p.alive && p.id !== me).map((p) => p.id);
  const replies = Array.from({ length: BUDGET[level].replies }, () => {
    const orders: Order[][] = state.players.map(() => []);
    for (const rival of rivals) orders[rival] = randomPlan(state, rival, rng);
    return orders;
  });
  let best: Order[] = [];
  let bestScore = -Infinity;
  for (let i = 0; i < BUDGET[level].plans; i++) {
    const plan = randomPlan(state, me, rng);
    let total = 0;
    for (const reply of replies)
      total += evaluate(
        simulate(
          state,
          reply.map((o, p) => (p === me ? plan : o)),
        ).state,
        me,
      );
    if (total > bestScore) {
      bestScore = total;
      best = plan;
    }
    await checkpoint();
  }
  return best;
}

export default defineBot({
  id: 'montecarlo',
  name: 'Monte Carlo',
  description: {
    en: 'Baseline: random plans scored by simulation, no strategy',
    es: 'Referencia: planes al azar puntuados simulando, sin estrategia',
  },
  order: 60,
  create: ({ level }) => ({ decide: (view, ctx) => decide(view, ctx.rng, level, () => ctx.checkpoint()) }),
});

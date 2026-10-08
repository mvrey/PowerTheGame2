import { Bot, BotDefinition, FleetOrder, PublicState, Rng, defineBot, isOut, simulate } from '../../api';

// The generic baseline of Design.md §2: no idea about Konquest beyond the rules. It draws random
// plans (random fleets from random planets), plays each a few turns ahead against random rivals
// with random dice, and keeps the plan whose futures leave it with the most ships and planets
// compared with the best rival. If a search this blind wins, the game is too shallow.

const SETTINGS = {
  1: { plans: 6, rollouts: 2, horizon: 5 },
  2: { plans: 16, rollouts: 3, horizon: 6 },
  3: { plans: 32, rollouts: 4, horizon: 8 },
};

/** A random plan: each planet, half of the time, sends a random share of its ships somewhere. */
function randomPlan(state: PublicState, player: number, rng: Rng): FleetOrder[] {
  const orders: FleetOrder[] = [];
  for (const home of state.planets) {
    if (home.owner !== player || home.ships < 1 || rng() < 0.5) continue;
    const to = Math.floor(rng() * (state.planets.length - 1));
    const ships = Math.max(1, Math.round(home.ships * rng()));
    orders.push({ from: home.id, to: to >= home.id ? to + 1 : to, ships });
  }
  return orders;
}

/** Ships plus ten turns of production: what a player is worth. */
function worth(state: PublicState, player: number): number {
  if (isOut(state, player)) return 0;
  let value = 0;
  for (const p of state.planets) if (p.owner === player) value += p.ships + 10 * p.production;
  for (const f of state.fleets) if (f.owner === player) value += f.ships;
  return value;
}

const definition: BotDefinition = defineBot({
  id: 'montecarlo',
  name: 'Monte Carlo',
  description: {
    en: 'Generic baseline: random plans scored by random playouts',
    es: 'Referencia genérica: planes al azar puntuados con partidas al azar',
  },
  order: 90,
  create: ({ level }): Bot => ({
    async decide({ me, state }, { rng, checkpoint }) {
      const { plans, rollouts, horizon } = SETTINGS[level];
      const candidates = [[], ...Array.from({ length: plans }, () => randomPlan(state, me, rng))];
      let best: FleetOrder[] = [];
      let bestScore = -Infinity;
      for (const plan of candidates) {
        let score = 0;
        for (let r = 0; r < rollouts; r++) {
          let future = state;
          for (let t = 0; t < horizon && !future.over; t++) {
            const orders = future.players.map((p) =>
              !p.alive ? [] : p.id === me && t === 0 ? plan : randomPlan(future, p.id, rng),
            );
            future = simulate(future, orders, { rng }).state;
          }
          const rivals = future.players.filter((p) => p.id !== me).map((p) => worth(future, p.id));
          score += worth(future, me) - Math.max(0, ...rivals);
          await checkpoint();
        }
        if (score > bestScore) [best, bestScore] = [plan, score];
      }
      return best;
    },
  }),
});

export default definition;

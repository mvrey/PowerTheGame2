import { FleetOrder, NEUTRAL, defineBot, travelTime } from '../../api';

// A greedy baseline, with no look at what rivals are doing: each planet keeps a small guard and
// sends just enough ships (with a margin for bad dice) at the target that gives the most
// production per ship and per turn of flight.

export default defineBot({
  id: 'greedy',
  name: 'Greedy',
  description: {
    en: 'Baseline: the most production per ship sent, ignoring the rivals',
    es: 'Referencia: la mayor producción por nave enviada, sin mirar a los rivales',
  },
  levels: false,
  order: 40,
  create: () => ({
    decide({ me, state }) {
      const ships = state.planets.map((p) => p.ships);
      const coming = (planet: number) =>
        state.fleets.filter((f) => f.to === planet && f.owner === me).reduce((sum, f) => sum + f.ships, 0);
      const taken = new Set<number>();
      const orders: FleetOrder[] = [];
      for (const home of state.planets) {
        if (home.owner !== me) continue;
        const guard = Math.ceil(home.production / 2);
        const options = state.planets
          .filter((p) => p.owner !== me && !taken.has(p.id))
          .map((p) => {
            const turns = travelTime(home, p);
            const growth = p.owner === NEUTRAL ? state.rules.neutralProduction : p.production;
            // Odds are even at equal kill rates; a margin covers the dice and their better shots.
            const needed = Math.ceil((ships[p.id] + growth * turns) * (p.kill / home.kill) * 1.25) + 1 - coming(p.id);
            return { p, needed, value: p.production / (Math.max(1, needed) * turns) };
          })
          .filter((o) => o.needed > 0 && o.needed <= ships[home.id] - guard)
          .sort((a, b) => b.value - a.value);
        const best = options[0];
        if (!best) continue;
        ships[home.id] -= best.needed;
        taken.add(best.p.id);
        orders.push({ from: home.id, to: best.p.id, ships: best.needed });
      }
      return orders;
    },
  }),
});

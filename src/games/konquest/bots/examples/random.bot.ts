import { FleetOrder, defineBot } from '../../api';

// A small example: each of its planets, now and then, sends part of its ships to a planet picked
// at random. Every order is legal. The sparring partner of `jam check`.

export default defineBot({
  id: 'rookie',
  name: 'Rookie',
  description: { en: 'Example bot: random fleets', es: 'Bot de ejemplo: flotas al azar' },
  levels: false,
  order: 50,
  create: () => ({
    decide({ me, state }, { rng }) {
      const orders: FleetOrder[] = [];
      for (const home of state.planets) {
        if (home.owner !== me || home.ships < 2 || rng() < 0.5) continue;
        const targets = state.planets.filter((p) => p.id !== home.id);
        const to = targets[Math.floor(rng() * targets.length)];
        orders.push({ from: home.id, to: to.id, ships: Math.max(1, Math.floor(home.ships * (0.3 + 0.6 * rng()))) });
      }
      return orders;
    },
  }),
});

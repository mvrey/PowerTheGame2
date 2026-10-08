import { FleetOrder, defineBot, distance } from '../../api';
import { inGridOrder } from './grid';

// KDE's default AI (konquest/src/players/ai/default/default.cpp), at its three settings. From each
// planet with enough ships it sends 70% of them to the closest planet it can outnumber that no
// fleet of its is heading to yet; if there is none, it tops up its closest weak planet.

const SETTINGS = {
  1: { minimumShips: 20, shipCountFactor: 2 }, // Weak
  2: { minimumShips: 10, shipCountFactor: 2 }, // Offensive
  3: { minimumShips: 30, shipCountFactor: 3 }, // Defensive
};

export default defineBot({
  id: 'kde',
  name: 'KDE Default',
  description: {
    en: "KDE Konquest's own AI: grabs the closest planet it outnumbers",
    es: 'La IA de Konquest de KDE: toma el planeta más cercano al que supera en naves',
  },
  levelNames: {
    1: { en: 'Weak', es: 'Débil' },
    2: { en: 'Offensive', es: 'Ofensiva' },
    3: { en: 'Defensive', es: 'Defensiva' },
  },
  order: 10,
  create: ({ level }) => ({
    decide({ me, state }) {
      const { minimumShips, shipCountFactor } = SETTINGS[level];
      const planets = inGridOrder(state.planets);
      // Ships leave as orders are given, so later planets see what earlier ones sent.
      const ships = state.planets.map((p) => p.ships);
      const targeted = (planet: number) => state.fleets.some((f) => f.owner === me && f.to === planet);
      const orders: FleetOrder[] = [];
      const send = (from: number, to: number, count: number) => {
        // KDE would launch an empty fleet; the rules here refuse one.
        if (count < 1) return;
        ships[from] -= count;
        orders.push({ from, to, ships: count });
      };

      for (const home of planets) {
        if (home.owner !== me) continue;
        const count = Math.floor(ships[home.id] * 0.7);
        if (count < minimumShips) continue;
        let target: number | null = null;
        let minDistance = 100;
        for (const attack of planets) {
          if (attack.owner === me) continue;
          const dist = distance(home, attack);
          if (dist < minDistance && ships[attack.id] < count && !targeted(attack.id)) {
            target = attack.id;
            minDistance = dist;
          }
        }
        if (target !== null) {
          send(home.id, target, count);
          continue;
        }
        let toSend = 0;
        minDistance = Infinity;
        for (const other of planets) {
          const dist = distance(home, other);
          const half = Math.floor(ships[home.id] * 0.5);
          if (dist < minDistance && other.owner === me && ships[other.id] < half && !targeted(other.id)) {
            toSend = Math.floor((ships[home.id] - ships[other.id]) / shipCountFactor);
            target = other.id;
            minDistance = dist;
          }
        }
        if (target !== null) send(home.id, target, toSend);
      }
      return orders;
    },
  }),
});

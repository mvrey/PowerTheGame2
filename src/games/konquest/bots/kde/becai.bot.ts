// SPDX-FileCopyrightText: 2013 Alexander Schuch (KDE Konquest); port for this project.
// SPDX-License-Identifier: GPL-2.0-or-later

import { FleetOrder, NEUTRAL, Planet, defineBot, distance } from '../../api';
import { inGridOrder } from './grid';

// KDE's Becai AI (konquest/src/players/ai/becai/becai.cpp, by Alexander Schuch), ported line by
// line. Every planet keeps a defence sized to the game situation (more for planets that kill
// and produce more); the surplus attacks the best-scored targets (cheap, close, productive,
// enemy before neutral), then supports a weak planet nearby, or moves on to a better-defended one.

interface Target {
  planet: Planet;
  /** Ships needed to take it, counting what it builds while the fleet travels. */
  needed: number;
  distance: number;
  score: number;
}

/** C's int conversion: towards zero. */
const int = (x: number) => Math.trunc(x);

export default defineBot({
  id: 'becai',
  name: 'Becai',
  description: {
    en: "KDE Konquest's balanced AI: measured defence, best-scored attacks",
    es: 'La IA equilibrada de Konquest de KDE: defensa medida y ataques bien elegidos',
  },
  levels: false,
  order: 20,
  create: () => ({
    decide({ me, state }) {
      const planets = inGridOrder(state.planets);
      const ships = state.planets.map((p) => p.ships);
      const orders: FleetOrder[] = [];
      const inFlight = state.fleets.filter((f) => f.owner === me);
      const heading = (planet: number) => inFlight.some((f) => f.to === planet) || orders.some((o) => o.to === planet);
      const send = (from: number, to: number, count: number) => {
        ships[from] -= count;
        orders.push({ from, to, ships: count });
      };

      // The game situation.
      let totalOwnProduction = 0;
      let totalOwnPlanets = 0;
      let totalOwnFleet = inFlight.reduce((sum, f) => sum + f.ships, 0);
      let totalEnemyPlanets = 0;
      let totalEnemyDefence = 0;
      let totalKillPercentage = 0;
      let others: number[] = [];
      for (const planet of planets) {
        if (planet.owner === me) {
          totalOwnProduction += planet.production;
          totalOwnPlanets += 1;
          totalOwnFleet += ships[planet.id];
          totalKillPercentage += planet.kill;
        } else {
          if (planet.owner !== NEUTRAL) {
            totalEnemyPlanets += 1;
            totalEnemyDefence += ships[planet.id];
          }
          others.push(ships[planet.id]);
        }
      }

      // The average defence of the planets that are not ours, without the top and bottom 10%.
      others.sort((a, b) => a - b);
      const trim = Math.floor(others.length / 10);
      others = others.slice(trim, others.length - trim);
      let averageOtherDefence = others.reduce((sum, n) => sum + n, 0);
      if (others.length) averageOtherDefence = Math.ceil(averageOtherDefence / others.length);

      // Fleets still flying but no planet: nothing to decide.
      if (totalOwnPlanets === 0) return [];

      const averageOwnKill = totalKillPercentage / totalOwnPlanets;
      const averageOwnProduction = totalOwnProduction / totalOwnPlanets;

      let baseDefence = Math.ceil(
        (totalOwnFleet / 2 / totalOwnPlanets) * (1 - totalOwnPlanets / (totalOwnPlanets + totalEnemyPlanets)),
      );
      const originalBaseDefence = baseDefence;
      const cappedBaseDefence = int(1.5 * averageOtherDefence);
      const enemyAttackPerOwnPlanet = Math.ceil(totalEnemyDefence / totalOwnPlanets);
      if (baseDefence > cappedBaseDefence) baseDefence = cappedBaseDefence;
      if (baseDefence > enemyAttackPerOwnPlanet) {
        baseDefence = enemyAttackPerOwnPlanet;
        // End game: keep enough to stop a small fleet.
        if (baseDefence < averageOwnProduction) baseDefence = originalBaseDefence;
      }
      // No enemy planet left but enemy fleets flying: spread the defence evenly.
      if (totalEnemyPlanets === 0) baseDefence = int(totalOwnFleet / totalOwnPlanets);

      const minimumDefence = (planet: Planet) =>
        Math.ceil((((baseDefence * planet.kill) / averageOwnKill) * planet.production) / averageOwnProduction);

      for (const home of planets) {
        if (home.owner !== me) continue;
        let surplus = ships[home.id] - minimumDefence(home);

        let upstream = home;
        let upstreamDistance = Infinity;
        let support = home;
        let supportDistance = Infinity;
        const targets: Target[] = [];

        for (const other of planets) {
          if (other.owner === me) {
            if (other === home) continue;
            const dist = distance(home, other);
            // The closest own planet that kills better.
            if (dist <= upstreamDistance && other.kill > home.kill) {
              upstream = other;
              upstreamDistance = dist;
            }
            // The closest own planet below its defence.
            if (dist <= supportDistance && ships[other.id] < minimumDefence(other)) {
              support = other;
              supportDistance = dist;
            }
          } else if (!heading(other.id)) {
            const dist = distance(home, other);
            const isNeutral = other.owner === NEUTRAL;
            const production = isNeutral ? state.rules.neutralProduction : other.production;
            let killOther = other.kill;
            const killHome = home.kill;
            if (killOther < 0.1) killOther = 0.1;
            // (Sic: KDE guards the other planet's value here too.)
            if (killHome < 0.1) killOther = 0.1;
            let needed = Math.ceil(((ships[other.id] + Math.ceil(dist) * production) * killOther) / killHome);
            if (needed === 0) needed = 1;
            let score = needed * dist;
            score *= 1 / (killOther / averageOwnKill);
            score *= 1 / (other.production / averageOwnProduction);
            // Neutrals do not harm us; enemies do.
            targets.push({ planet: other, needed, distance: dist, score: (isNeutral ? 1.1 : 1.0) * score });
          }
        }

        // Best targets first (equal scores: the latest found first, as Qt's QMultiMap gives them).
        const ranked = targets.map((t, i) => ({ t, i })).sort((a, b) => a.t.score - b.t.score || b.i - a.i);
        let skips = 3;
        for (const { t } of ranked) {
          if (skips <= 0) break;
          skips--;
          if (upstream !== home && t.distance > 2 * upstreamDistance) continue;
          if (surplus > 0 && surplus > t.needed) {
            const defence = minimumDefence(t.planet);
            const size = surplus > t.needed + defence ? t.needed + defence : surplus;
            if (size > 0) {
              send(home.id, t.planet.id, size);
              surplus -= size;
              skips++;
            }
          }
        }

        // Surplus left: support a weak planet nearby, if no fleet of ours is on its way there.
        if (support !== home && supportDistance < 2 * upstreamDistance && !heading(support.id) && surplus > 0) {
          send(home.id, support.id, surplus);
          surplus = 0;
        }
        // Or gather it, in large chunks, on the closest planet that kills better.
        if (upstream !== home && surplus > 3 * home.production) send(home.id, upstream.id, surplus);
      }
      return orders;
    },
  }),
});

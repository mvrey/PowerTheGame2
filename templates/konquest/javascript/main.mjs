// A starter Konquest bot: each planet keeps a guard and sends just enough ships at the planet that
// is cheapest to take per turn of flight.
//
// Run it locally against a built-in bot:
//   npm run jam -- match --game konquest --bot <this folder> --bot builtin:kde:2
//
// Ideas to make it yours: count the enemy fleets heading for your planets (observation.state.fleets)
// and defend, prefer productive planets, gather ships before a big attack, and use the kill
// percentages: a planet that kills better is a better base to attack from.

import { run } from './jam.mjs';
import { fleetsTo, growth, myPlanets, otherPlanets, send, travelTime } from './konquest.mjs';

const starter = {
  onHello(hello) {
    this.info = hello.info;
  },

  onTurn(observation) {
    const me = observation.you;
    const orders = [];
    const targeted = new Set();
    for (const home of myPlanets(observation)) {
      const spare = home.ships - home.production; // keep a turn of production at home
      let best = null;
      for (const target of otherPlanets(observation)) {
        if (targeted.has(target.id)) continue;
        const turns = travelTime(home, target);
        const mineOnTheWay = fleetsTo(observation, target.id)
          .filter((f) => f.owner === me)
          .reduce((sum, f) => sum + f.ships, 0);
        // What it will have when we land, with a margin for the dice and its kill rate.
        const needed =
          Math.floor(((target.ships + growth(observation, target) * turns) * target.kill * 1.3) / home.kill) +
          1 -
          mineOnTheWay;
        if (needed > 0 && needed <= spare && (!best || needed * turns < best.cost))
          best = { cost: needed * turns, target, needed };
      }
      if (best) {
        targeted.add(best.target.id);
        orders.push(send(home.id, best.target.id, best.needed));
      }
    }
    return { orders };
  },
};

run(starter);

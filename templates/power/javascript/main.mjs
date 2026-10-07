// A starter Power bot: it brings its Reserve to the board and marches on the nearest enemy HQ.
//
// Run it locally against a built-in bot:
//   npm run jam -- match --bot <this folder> --bot builtin:rookie
//
// Ideas to make it yours: buy pieces with your Power, trade three small pieces up, keep a guard
// at home, avoid walking into stronger stacks (observation.state.pieces shows everything), and
// watch what your opponent did last round (observation.previous).

import { run } from './jam.mjs';
import { Board, RESERVE, move, myPieces } from './power.mjs';

/** Small seeded random numbers: use the match seed, not Math.random, so games can be replayed. */
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const starter = {
  onHello(hello) {
    this.board = new Board(hello.info);
    this.random = makeRandom(hello.match.seed);
  },

  onTurn(observation) {
    const { state } = observation;
    const orders = [];
    const perArmy = new Map();
    // Each army takes at most 5 orders, and you at most maxOrders in all: more are refused.
    const add = (order) => {
      const used = perArmy.get(order.army) ?? 0;
      if (orders.length >= observation.maxOrders || used >= observation.ordersPerArmy) return;
      orders.push(order);
      perArmy.set(order.army, used + 1);
    };

    // Everything waiting in the Reserve goes to its headquarters.
    for (const order of observation.legal) if (order.kind === 'move' && order.from === RESERVE) add(order);

    // Every piece on the board takes the step that brings it closest to an enemy HQ.
    const targets = state.armies
      .filter((army) => army.alive && army.controller !== observation.you && army.controller !== -1)
      .map((army) => this.board.hq[army.id]);
    const pieces = myPieces(observation).filter((p) => p.loc !== RESERVE && this.board.moveClass(p.type));
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    for (const piece of pieces) {
      const steps = this.board.reach(piece.type, piece.loc);
      if (!steps.length || !targets.length) continue;
      const distance = (node) =>
        Math.min(99, ...targets.map((hq) => this.board.movesNeeded(piece.type, node, hq) ?? 99));
      const best = steps.reduce((a, b) => (distance(b) < distance(a) ? b : a));
      add(move(piece.army, piece.type, piece.loc, best));
    }

    return { orders };
  },
};

run(starter);

// Helpers for Power bots in JavaScript. No dependencies; copy this file next to your bot.
//
// Everything here is a convenience over the JSON described in Docs/Games/Power.md: the board and
// the rules come in `hello.info`, the game state in every turn's observation.

/** `loc` of a piece in a Reserve; `from`/`target` of orders about a Reserve. */
export const RESERVE = -1;
/** The pieces you can buy: Soldier, Tank, Fighter, Destroyer. */
export const GROUP1 = ['S', 'T', 'F', 'D'];

/** The map of a match, from hello.info. */
export class Board {
  constructor(info) {
    const board = info.board;
    this.nodes = board.nodes; // [{idx, id, kind, army, num, coastal}]
    this.hq = board.hq; // hq[army] = node of that army's headquarters
    this.territory = board.territory; // territory[army] = its sector nodes
    this.adj = board.adj; // adj[node] = neighbouring nodes
    this.pieces = info.pieces; // pieces[type] = {power, cls, group, up?, base?}
    this.reachTable = board.reach; // reach[cls][node] = nodes one move away
    this.roundsTable = board.rounds; // rounds[cls][a][b] = moves needed (null: never)
  }

  /** 'inf', 'tank', 'air' or 'naval'; null for the Megamissile, which cannot move. */
  moveClass(type) {
    return this.pieces[type].cls;
  }

  /** Nodes a piece of this type can reach from `node` in one move. */
  reach(type, node) {
    const cls = this.moveClass(type);
    return cls ? this.reachTable[cls][node] : [];
  }

  /** Rounds of movement from one node to another (null if it can never get there). */
  movesNeeded(type, from, to) {
    const cls = this.moveClass(type);
    return cls ? this.roundsTable[cls][from][to] : null;
  }

  powerOf(type) {
    return this.pieces[type].power;
  }
}

/** Your pieces (in your living armies), on the board and in your Reserves. */
export function myPieces(observation) {
  const mine = new Set(observation.armies);
  return observation.state.pieces.filter((p) => mine.has(p.army));
}

export const piecesAt = (state, node) => state.pieces.filter((p) => p.loc === node);

/** The player controlling an army (-1 for the mercenaries). */
export const teamOf = (state, army) => state.armies[army].controller;

// Orders. Return them in a list: { orders: [move(...), buy(...), ...] }

/** Move one piece. from = RESERVE deploys it to its army's HQ (then `to` is that HQ). */
export const move = (army, type, from, to) => ({ kind: 'move', army, type, from, to });
/** Buy a Soldier, Tank, Fighter or Destroyer with Power; it appears in the Reserve. */
export const buy = (army, type) => ({ kind: 'buy', army, type });
/** Trade three pieces of a small type at `at` (a node or RESERVE) for the big one. */
export const tradeUp = (army, type, at) => ({ kind: 'tradeUp', army, type, at });
/** Build a Megamissile at `at` from pieces worth 100+ ({ S: 2, R: 1, ... }), plus Power in the Reserve. */
export const makeMissile = (army, at, spend, power = 0) => ({ kind: 'makeMissile', army, at, spend, power });
/** Launch a Megamissile at a node, or at an army's Reserve (target = RESERVE, targetArmy = that army). */
export const launch = (army, from, target, targetArmy = -1) => ({ kind: 'launch', army, from, target, targetArmy });

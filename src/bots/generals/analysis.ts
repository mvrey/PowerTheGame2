import { ORDERS_PER_ARMY, PIECES, PieceType, RESERVE, ReadonlyGameState, boardOf, orderAllowance } from '../../api';

/** What a piece is worth to the AI. A megamissile has no combat power but is far from worthless. */
export const VALUE: Record<PieceType, number> = { S: 2, T: 3, F: 5, D: 10, R: 20, H: 30, B: 25, C: 50, M: 75 };

/** Sides are indexed controller + 1, so mercenaries are side 0. */
export const sideOf = (state: ReadonlyGameState, army: number) => state.armies[army].controller + 1;

/** Who stands where, and who could get where next round. Tables are indexed [node][side]. */
export interface Analysis {
  sides: number;
  /** Combat power standing on the node. */
  power: number[][];
  /** Worth (VALUE) of the pieces standing on the node. */
  value: number[][];
  /** The most power the side could have on the node after one round. */
  potential: number[][];
  /** Whether the side could have infantry on the node after one round. */
  canBringInfantry: boolean[][];
}

export function analyse(state: ReadonlyGameState): Analysis {
  const { hq, numNodes, reach } = boardOf(state);
  const sides = state.players.length + 1;
  const table = <T>(make: () => T): T[][] =>
    Array.from({ length: numNodes }, () => Array.from({ length: sides }, make));
  const power = table(() => 0);
  const value = table(() => 0);
  const canBringInfantry = table(() => false);
  const arrivals = table<number[]>(() => []);

  for (const p of state.pieces) {
    const def = PIECES[p.type];
    const side = sideOf(state, p.army);
    const infantry = def.cls === 'inf';
    if (p.loc === RESERVE) {
      if (def.cls) {
        arrivals[hq[p.army]][side].push(def.power);
        if (infantry) canBringInfantry[hq[p.army]][side] = true;
      }
      continue;
    }
    power[p.loc][side] += def.power;
    value[p.loc][side] += VALUE[p.type];
    if (infantry) canBringInfantry[p.loc][side] = true;
    if (!def.cls) continue;
    for (const to of reach[def.cls][p.loc]) {
      arrivals[to][side].push(def.power);
      if (infantry) canBringInfantry[to][side] = true;
    }
  }

  // A side can only move as many pieces as it has orders: the strongest arrivals count.
  const orders = new Array<number>(sides).fill(ORDERS_PER_ARMY);
  for (const player of state.players) orders[player.id + 1] = orderAllowance(state, player.id);
  const potential = power.map((row, node) =>
    row.map((standing, side) => {
      const strongestFirst = [...arrivals[node][side]].sort((a, b) => b - a);
      return standing + strongestFirst.slice(0, orders[side]).reduce((sum, p) => sum + p, 0);
    }),
  );
  return { sides, power, value, potential, canBringInfantry };
}

/** Strongest hostile presence on a node, optionally only counting sides able to bring infantry. */
export function hostile(
  analysis: Analysis,
  table: number[][],
  node: number,
  mySide: number,
  needInfantry = false,
): number {
  let best = 0;
  for (let side = 0; side < analysis.sides; side++) {
    if (side === mySide || (needInfantry && !analysis.canBringInfantry[node][side])) continue;
    best = Math.max(best, table[node][side]);
  }
  return best;
}

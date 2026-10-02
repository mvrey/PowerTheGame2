import { HQ, NUM_NODES, REACH, RESERVE } from '../engine/board';
import { GameState, ORDERS_PER_ARMY, PieceType, PIECES } from '../engine/types';

/** What a piece is worth to the AI. A megamissile has no combat power but is far from worthless. */
export const VALUE: Record<PieceType, number> = { S: 2, T: 3, F: 5, D: 10, R: 20, H: 30, B: 25, C: 50, M: 75 };

/** Teams are indexed controller + 1, so mercenaries are side 0. */
export const sideOf = (state: GameState, army: number) => state.armies[army].controller + 1;

export interface Analysis {
  sides: number;
  /** power[node][side]: combat power standing on the node. */
  power: number[][];
  /** value[node][side]: worth of the pieces standing on the node. */
  value: number[][];
  /** pot[node][side]: the most power the side could have on the node after one round. */
  pot: number[][];
  /** inf[node][side]: the side could have infantry on the node after one round. */
  inf: boolean[][];
}

export function analyse(state: GameState): Analysis {
  const sides = state.players.length + 1;
  const grid = <T>(make: () => T): T[][] =>
    Array.from({ length: NUM_NODES }, () => Array.from({ length: sides }, make));
  const power = grid(() => 0);
  const value = grid(() => 0);
  const inf = grid(() => false);
  const arrivals = grid<number[]>(() => []);

  for (const p of state.pieces) {
    const def = PIECES[p.type];
    const side = sideOf(state, p.army);
    const infantry = def.cls === 'inf';
    if (p.loc === RESERVE) {
      if (def.cls) {
        arrivals[HQ[p.army]][side].push(def.power);
        if (infantry) inf[HQ[p.army]][side] = true;
      }
      continue;
    }
    power[p.loc][side] += def.power;
    value[p.loc][side] += VALUE[p.type];
    if (infantry) inf[p.loc][side] = true;
    if (!def.cls) continue;
    for (const to of REACH[def.cls][p.loc]) {
      arrivals[to][side].push(def.power);
      if (infantry) inf[to][side] = true;
    }
  }

  const orders = new Array<number>(sides).fill(ORDERS_PER_ARMY);
  for (const pl of state.players)
    orders[pl.id + 1] = ORDERS_PER_ARMY * pl.armies.filter((a) => state.armies[a].alive).length;
  const pot = power.map((row, node) =>
    row.map((standing, side) => {
      const list = arrivals[node][side];
      if (!list.length) return standing;
      list.sort((a, b) => b - a);
      let total = standing;
      for (let i = 0; i < list.length && i < orders[side]; i++) total += list[i];
      return total;
    }),
  );
  return { sides, power, value, pot, inf };
}

/** Strongest hostile presence on a node, optionally only counting sides able to bring infantry. */
export function hostile(an: Analysis, table: number[][], node: number, mySide: number, needInf = false): number {
  let best = 0;
  for (let s = 0; s < an.sides; s++) {
    if (s === mySide || (needInf && !an.inf[node][s])) continue;
    if (table[node][s] > best) best = table[node][s];
  }
  return best;
}

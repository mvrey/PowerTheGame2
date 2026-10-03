import { GameState, MERC, PIECES, PieceType, RESERVE, boardOf } from '../../api';
import { VALUE, analyse, hostile } from './analysis';

/** Temperament of an AI general: how much each concern weighs. */
export interface Style {
  aggression: number;
  caution: number;
  greed: number;
}

export const BALANCED: Style = { aggression: 1, caution: 1, greed: 1 };

const WIN = 100000;

/** How good `state` looks for player `me`. Higher is better. */
export function evaluate(state: GameState, me: number, style: Style = BALANCED): number {
  const { hq: HQ, nodes: NODES, numNodes: NUM_NODES, rounds: ROUNDS } = boardOf(state);
  const player = state.players[me];
  if (!player.alive) return -WIN;
  if (state.over) return state.winners.includes(me) ? WIN / state.winners.length : -WIN / 2;

  const an = analyse(state);
  const mySide = me + 1;
  let score = 0;

  // Material: mine against the average living rival.
  const rival = new Array<number>(state.players.length).fill(0);
  const pairs = new Map<string, number>();
  const enemyHQs = state.armies.filter((a) => a.alive && a.controller !== me && a.controller !== MERC).map((a) => HQ[a.id]);
  for (const p of state.pieces) {
    const owner = state.armies[p.army].controller;
    if (owner === MERC) continue;
    const worth = VALUE[p.type];
    if (owner !== me) {
      rival[owner] += worth;
      continue;
    }
    score += p.loc === RESERVE ? worth * 0.9 : worth;
    if (PIECES[p.type].group === 1) {
      const key = `${p.army}:${p.loc}:${p.type}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    // Pressure: pieces close to an enemy HQ are worth a little more.
    const cls = PIECES[p.type].cls;
    if (p.loc !== RESERVE && cls) {
      let nearest = Infinity;
      for (const hq of enemyHQs) nearest = Math.min(nearest, ROUNDS[cls][p.loc][hq]);
      if (nearest < 4) score += style.aggression * worth * 0.04 * (4 - nearest);
      // Infantry is what takes flags: reward getting it there.
      if (cls === 'inf' && nearest < 6) score += style.aggression * 1.5 * (6 - nearest);
    }
  }
  for (const army of state.armies) {
    if (army.controller === me) score += army.power * 0.9;
    else if (army.controller !== MERC) rival[army.controller] += army.power;
  }
  const rivals = state.players.filter((p) => p.alive && p.id !== me);
  if (rivals.length) score -= (0.5 * rivals.reduce((sum, p) => sum + rival[p.id], 0)) / rivals.length;
  score += 150 * state.players.filter((p) => !p.alive).length;

  // Two of a kind together are most of the way to a trade-up.
  for (const [key, n] of pairs) {
    if (n < 2) continue;
    const type = key.split(':')[2] as PieceType;
    const gain = PIECES[PIECES[type].up!].power - 3 * PIECES[type].power;
    score += gain * (n >= 3 ? 0.5 : 0.2);
  }

  // Flag safety: an enemy able to bring infantry and more power than the garrison is a mortal threat.
  for (const a of player.armies) {
    if (!state.armies[a].alive) continue;
    const threat = hostile(an, an.pot, HQ[a], mySide, true);
    const garrison = an.power[HQ[a]][mySide];
    if (threat > garrison) score -= style.caution * (45 + Math.min(threat - garrison, 60));
  }

  const held = new Set<number>();
  for (let node = 0; node < NUM_NODES; node++) {
    const mine = an.value[node][mySide];
    if (!mine) continue;
    const info = NODES[node];
    // Exposure: stacks an enemy could overpower next round.
    if (info.kind !== 'hq' || !player.armies.includes(info.army)) {
      const danger = hostile(an, an.pot, node, mySide);
      if (danger > an.power[node][mySide]) score -= style.caution * 0.3 * mine;
    }
    if (info.kind === 'sector' && state.armies[info.army].alive && state.armies[info.army].controller !== me)
      held.add(info.army);
  }
  // Income: every enemy territory held keeps paying.
  score += style.greed * 3 * held.size;

  // Flags within grasp.
  for (const hq of enemyHQs) {
    if (!an.inf[hq][mySide]) continue;
    const owner = state.armies[NODES[hq].army].controller + 1;
    if (an.pot[hq][mySide] > an.pot[hq][owner]) score += style.aggression * 30;
    else if (an.pot[hq][mySide] > an.power[hq][owner]) score += style.aggression * 8;
  }
  return score;
}

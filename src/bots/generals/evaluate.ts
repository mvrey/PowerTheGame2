import { Board, GROUP1, MERC, PIECES, PieceType, RESERVE, ReadonlyGameState, boardOf } from '../../api';
import { Analysis, VALUE, analyse, hostile } from './analysis';

/** Temperament of an AI general: how much each concern weighs. */
export interface Style {
  aggression: number;
  caution: number;
  greed: number;
}

export const BALANCED: Style = { aggression: 1, caution: 1, greed: 1 };

// Weights of the position score, tuned by self-play with the arena. Material is the unit:
// a Soldier is worth 2.
const WIN = 100000;
/** Pieces in the Reserve and Power units still have to reach the board. */
const IN_RESERVE = 0.9;
/** Rival material counts half: hurting one rival also helps the others. */
const RIVAL_MATERIAL = 0.5;
const PER_ELIMINATED_PLAYER = 150;
/** Pieces within this many rounds of an enemy HQ put pressure on it. */
const PRESSURE_RANGE = 4;
const PRESSURE_PER_VALUE = 0.04;
/** Infantry within this many rounds of an enemy HQ is a threat to its flag. */
const MARCH_RANGE = 6;
const MARCH_PER_ROUND = 1.5;
const PAIR_OF_TWO = 0.2;
const PAIR_OF_THREE = 0.5;
const FLAG_THREAT = 45;
const FLAG_THREAT_EXCESS_CAP = 60;
const EXPOSED_SHARE = 0.3;
const PER_TERRITORY_HELD = 3;
const FLAG_WITHIN_REACH = 30;
const FLAG_CONTESTED = 8;

/** Everything the scoring terms look at. */
interface Position {
  state: ReadonlyGameState;
  board: Board;
  me: number;
  mySide: number;
  style: Style;
  analysis: Analysis;
  enemyHQs: number[];
}

/** How good `state` looks for player `me`. Higher is better. */
export function evaluate(state: ReadonlyGameState, me: number, style: Style = BALANCED): number {
  if (!state.players[me].alive) return -WIN;
  if (state.over) return state.winners.includes(me) ? WIN / state.winners.length : -WIN / 2;

  const board = boardOf(state);
  const enemyHQs = state.armies
    .filter((a) => a.alive && a.controller !== me && a.controller !== MERC)
    .map((a) => board.hq[a.id]);
  const position: Position = { state, board, me, mySide: me + 1, style, analysis: analyse(state), enemyHQs };
  return (
    material(position) +
    pressure(position) +
    tradeUpPairs(position) +
    flagSafety(position) +
    exposure(position) +
    income(position) +
    flagsWithinReach(position)
  );
}

/** Mine against the average living rival, plus every rival already out. */
function material({ state, me }: Position): number {
  let score = 0;
  const rival = new Array<number>(state.players.length).fill(0);
  for (const p of state.pieces) {
    const owner = state.armies[p.army].controller;
    if (owner === MERC) continue;
    if (owner !== me) rival[owner] += VALUE[p.type];
    else score += p.loc === RESERVE ? VALUE[p.type] * IN_RESERVE : VALUE[p.type];
  }
  for (const army of state.armies) {
    if (army.controller === me) score += army.power * IN_RESERVE;
    else if (army.controller !== MERC) rival[army.controller] += army.power;
  }
  const rivals = state.players.filter((p) => p.alive && p.id !== me);
  if (rivals.length) score -= (RIVAL_MATERIAL * rivals.reduce((sum, p) => sum + rival[p.id], 0)) / rivals.length;
  return score + PER_ELIMINATED_PLAYER * state.players.filter((p) => !p.alive).length;
}

/** Pieces close to an enemy HQ are worth a little more, infantry most: it is what takes flags. */
function pressure({ state, board, me, style, enemyHQs }: Position): number {
  let score = 0;
  for (const p of state.pieces) {
    const cls = PIECES[p.type].cls;
    if (p.loc === RESERVE || !cls || state.armies[p.army].controller !== me) continue;
    const nearest = Math.min(Infinity, ...enemyHQs.map((hq) => board.rounds[cls][p.loc][hq]));
    if (nearest < PRESSURE_RANGE)
      score += style.aggression * VALUE[p.type] * PRESSURE_PER_VALUE * (PRESSURE_RANGE - nearest);
    if (cls === 'inf' && nearest < MARCH_RANGE) score += style.aggression * MARCH_PER_ROUND * (MARCH_RANGE - nearest);
  }
  return score;
}

/** Two or three small pieces of a kind together are most of the way to a trade-up. */
function tradeUpPairs({ state, me }: Position): number {
  const groups = new Map<string, { type: PieceType; count: number }>();
  for (const p of state.pieces) {
    if (!GROUP1.includes(p.type) || state.armies[p.army].controller !== me) continue;
    const key = `${p.army}:${p.loc}:${p.type}`;
    const group = groups.get(key) ?? { type: p.type, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  let score = 0;
  for (const { type, count } of groups.values()) {
    if (count < 2) continue;
    const gain = PIECES[PIECES[type].up!].power - 3 * PIECES[type].power;
    score += gain * (count >= 3 ? PAIR_OF_THREE : PAIR_OF_TWO);
  }
  return score;
}

/** An enemy able to bring infantry and more power than the garrison is a mortal threat. */
function flagSafety({ state, board, me, mySide, style, analysis }: Position): number {
  let score = 0;
  for (const army of state.players[me].armies) {
    if (!state.armies[army].alive) continue;
    const hq = board.hq[army];
    const threat = hostile(analysis, analysis.potential, hq, mySide, true);
    const garrison = analysis.power[hq][mySide];
    if (threat > garrison) score -= style.caution * (FLAG_THREAT + Math.min(threat - garrison, FLAG_THREAT_EXCESS_CAP));
  }
  return score;
}

/** Stacks an enemy could overpower next round (the HQs are covered by flagSafety). */
function exposure({ state, board, me, mySide, style, analysis }: Position): number {
  let score = 0;
  for (let node = 0; node < board.numNodes; node++) {
    const mine = analysis.value[node][mySide];
    if (!mine) continue;
    const info = board.nodes[node];
    if (info.kind === 'hq' && state.players[me].armies.includes(info.army)) continue;
    if (hostile(analysis, analysis.potential, node, mySide) > analysis.power[node][mySide])
      score -= style.caution * EXPOSED_SHARE * mine;
  }
  return score;
}

/** Every enemy territory I stand on pays Power each round. */
function income({ state, board, me, mySide, style, analysis }: Position): number {
  const held = new Set<number>();
  for (let node = 0; node < board.numNodes; node++) {
    const info = board.nodes[node];
    if (!analysis.value[node][mySide] || info.kind !== 'sector') continue;
    const owner = state.armies[info.army];
    if (owner.alive && owner.controller !== me) held.add(info.army);
  }
  return style.greed * PER_TERRITORY_HELD * held.size;
}

/** Enemy flags my infantry could take next round. */
function flagsWithinReach({ state, board, mySide, style, analysis, enemyHQs }: Position): number {
  let score = 0;
  for (const hq of enemyHQs) {
    if (!analysis.canBringInfantry[hq][mySide]) continue;
    const ownerSide = state.armies[board.nodes[hq].army].controller + 1;
    const mine = analysis.potential[hq][mySide];
    if (mine > analysis.potential[hq][ownerSide]) score += style.aggression * FLAG_WITHIN_REACH;
    else if (mine > analysis.power[hq][ownerSide]) score += style.aggression * FLAG_CONTESTED;
  }
  return score;
}

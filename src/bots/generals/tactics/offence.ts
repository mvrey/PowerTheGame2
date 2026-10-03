import { MERC, OrderSheet, PIECES, RESERVE, ReadonlyPiece, cheapestMissileSpend } from '../../../api';
import { VALUE, hostile } from '../analysis';
import {
  Destination,
  PlanContext,
  assessDestination,
  canReach,
  isInfantry,
  isMine,
  movablePieces,
  moveOrder,
  myPowerAt,
  piecePower,
  strongestFirst,
} from '../planContext';
import { bestBy, pick } from '../random';
import { Tactic } from './tactic';

/** Worth of a flag in an attack, against the VALUE of the pieces at stake: it eliminates an army. */
const FLAG_PRIZE = 400;
/** A missile is only launched at a target worth at least this much. */
const MIN_STRIKE_GAIN = 30;
/** A missile is only built when its target is worth this much more than what it costs. */
const BUILD_MARGIN = 1.15;

interface AttackOption {
  node: number;
  force: ReadonlyPiece[];
  weight: number;
}

/** Converge on a space to overpower whoever stands there; on an enemy HQ, bring infantry for the flag. */
export const attack: Tactic = (ctx, sheet) => {
  const free = movablePieces(ctx, sheet);
  const options: AttackOption[] = [];
  for (let node = 0; node < ctx.board.numNodes; node++) {
    const option = attackOn(ctx, sheet, free, node);
    if (option) options.push(option);
  }
  const choice = pick(ctx.rng, options, (o) => o.weight * o.weight);
  if (!choice) return false;
  let added = false;
  for (const p of choice.force) added = sheet.add(moveOrder(p, choice.node)) || added;
  return added;
};

/** The smallest force that would take `node`, and how much taking it is worth; null if it cannot be done. */
function attackOn(ctx: PlanContext, sheet: OrderSheet, free: ReadonlyPiece[], node: number): AttackOption | null {
  const { analysis } = ctx;
  const info = ctx.board.nodes[node];
  const flagHere =
    info.kind === 'hq' && ctx.state.armies[info.army].alive && ctx.state.armies[info.army].controller !== ctx.me;
  let loot = 0;
  for (let side = 0; side < analysis.sides; side++) if (side !== ctx.side) loot += analysis.value[node][side];
  if (!loot && !flagHere) return null;

  const standing = hostile(analysis, analysis.power, node, ctx.side);
  const reinforcements = hostile(analysis, analysis.potential, node, ctx.side) - standing;
  // How much of the possible reinforcement to plan for: none, half or all of it.
  const roll = ctx.rng();
  const margin = (roll < 0.4 ? 0 : roll < 0.75 ? 0.5 : 1) * reinforcements * Math.min(1, ctx.style.caution);
  const near = free.filter((p) => p.loc !== node && canReach(ctx, p, node)).sort(strongestFirst);
  const force: ReadonlyPiece[] = [];
  let total = myPowerAt(ctx, sheet, node);
  let infantry = sheet.preview.pieces.some((p) => p.loc === node && isMine(ctx, p) && isInfantry(p));
  if (flagHere && !infantry) {
    const soldier = near.find(isInfantry);
    if (soldier) {
      force.push(soldier);
      total += piecePower(soldier);
      infantry = true;
    }
  }
  for (const p of near) {
    if (total > standing + margin) break;
    if (force.includes(p)) continue;
    force.push(p);
    total += piecePower(p);
  }
  if (total <= standing || !force.length) return null;
  // Drop whatever the attack does not need, smallest first.
  for (let i = force.length - 1; i >= 0; i--) {
    const p = force[i];
    const onlyInfantry = flagHere && isInfantry(p) && force.filter(isInfantry).length === 1;
    if (!onlyInfantry && total - piecePower(p) > standing + margin) {
      total -= piecePower(p);
      force.splice(i, 1);
    }
  }
  if (!force.length) return null;
  const ordersPerArmy = new Map<number, number>();
  for (const p of force) ordersPerArmy.set(p.army, (ordersPerArmy.get(p.army) ?? 0) + 1);
  if ([...ordersPerArmy].some(([army, n]) => n > sheet.left(army))) return null;
  const prize = loot + (flagHere && infantry ? FLAG_PRIZE : 0);
  if (prize <= 0) return null;
  const certainty = total > standing + margin ? 1 : 0.5;
  return { node, force, weight: (prize * certainty) / Math.sqrt(force.length) };
}

/**
 * The best move of `piece` that brings it closer to `goal` without walking into a stronger
 * force, scored by `score`; undefined when there is none.
 */
function stepTowards(
  ctx: PlanContext,
  sheet: OrderSheet,
  piece: ReadonlyPiece,
  goal: number,
  score: (roundsLeft: number, spot: Destination) => number,
): number | undefined {
  const cls = PIECES[piece.type].cls!;
  const rounds = ctx.board.rounds[cls];
  const now = rounds[piece.loc][goal];
  return bestBy(ctx.board.reach[cls][piece.loc], (to) => {
    const then = rounds[to][goal];
    if (then >= now) return null;
    const spot = assessDestination(ctx, sheet, piece, to);
    return spot.outmatched ? null : score(then, spot);
  });
}

/** March towards the objective's HQ, keeping together and out of harm's way when possible. */
export const advance: Tactic = (ctx, sheet) => {
  const goal = ctx.board.hq[ctx.objective];
  const movers = movablePieces(ctx, sheet).sort((x, y) => piecePower(y) - piecePower(x) + (ctx.rng() - 0.5) * 6);
  let quota = 1 + Math.floor(ctx.rng() * 3);
  let added = false;
  for (const p of movers) {
    if (quota <= 0) break;
    const to = stepTowards(
      ctx,
      sheet,
      p,
      goal,
      (then, spot) =>
        -then * 10 + (spot.safe ? 6 * ctx.style.caution : 0) + (spot.strength > piecePower(p) ? 3 : 0) + ctx.rng() * 3,
    );
    if (to !== undefined && sheet.add(moveOrder(p, to))) {
      quota--;
      added = true;
    }
  }
  return added;
};

/** Walk infantry towards the objective's HQ: nothing else can take a flag. */
export const march: Tactic = (ctx, sheet) => {
  const goal = ctx.board.hq[ctx.objective];
  const rounds = ctx.board.rounds.inf;
  const closestFirst = movablePieces(ctx, sheet)
    .filter(isInfantry)
    .sort((x, y) => rounds[x.loc][goal] - rounds[y.loc][goal] || piecePower(y) - piecePower(x));
  for (const p of closestFirst.slice(0, 2)) {
    const to = stepTowards(
      ctx,
      sheet,
      p,
      goal,
      (then, spot) =>
        -then * 10 + (spot.safe ? 8 * ctx.style.caution : 0) + Math.min(spot.strength, 30) * 0.2 + ctx.rng() * 2,
    );
    if (to !== undefined && sheet.add(moveOrder(p, to))) return true;
  }
  return false;
};

interface StrikeTarget {
  gain: number;
  target: number;
  targetArmy: number;
}

/** Where a megamissile would hurt the enemy most: a space, or an army's Reserve. */
function bestStrikeTarget(ctx: PlanContext): StrikeTarget {
  const { analysis } = ctx;
  let best: StrikeTarget = { gain: 0, target: 0, targetArmy: -1 };
  for (let node = 0; node < ctx.board.numNodes; node++) {
    // Own losses count double; mercenaries (side 0) are half a loss to anyone.
    let gain = -2 * analysis.value[node][ctx.side];
    for (let side = 0; side < analysis.sides; side++)
      if (side !== ctx.side) gain += analysis.value[node][side] * (side === 0 ? 0.5 : 1);
    if (gain > best.gain) best = { gain, target: node, targetArmy: -1 };
  }
  for (const enemy of ctx.state.armies) {
    if (!enemy.alive || enemy.controller === ctx.me || enemy.controller === MERC) continue;
    let gain = enemy.power;
    for (const p of ctx.state.pieces) if (p.army === enemy.id && p.loc === RESERVE) gain += VALUE[p.type];
    if (gain > best.gain) best = { gain, target: RESERVE, targetArmy: enemy.id };
  }
  return best;
}

/** Launch a megamissile where it hurts most, building one first if the target is worth it. */
export const missile: Tactic = (ctx, sheet) => {
  const best = bestStrikeTarget(ctx);
  const launchFrom = (army: number, from: number) =>
    sheet.add({ kind: 'launch', army, from, target: best.target, targetArmy: best.targetArmy });
  for (const army of ctx.armies) {
    const ready = sheet.preview.pieces.find((p) => p.army === army && p.type === 'M');
    if (ready) {
      if (best.gain >= MIN_STRIKE_GAIN && launchFrom(army, ready.loc)) return true;
      continue;
    }
    if (sheet.left(army) < 2) continue;
    const spots = new Set(
      sheet.preview.pieces.filter((p) => p.army === army && p.loc !== ctx.board.hq[army]).map((p) => p.loc),
    );
    spots.add(RESERVE);
    for (const at of spots) {
      const recipe = cheapestMissileSpend(sheet.preview, army, at);
      if (!recipe || best.gain < recipe.total * BUILD_MARGIN) continue;
      if (sheet.add({ kind: 'makeMissile', army, at, spend: recipe.spend, power: recipe.power })) {
        launchFrom(army, at);
        return true;
      }
    }
  }
  return false;
};

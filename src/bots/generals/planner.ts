import {
  Board, Bot, BotContext, BotLevel, GROUP1, GameState, MERC, Order, OrderSheet, PIECES, Piece, PieceType, PlayerView,
  RESERVE, Rng, boardOf, cheapestMissileSpend, livingArmies, simulate,
} from '../../api';
import { Analysis, VALUE, analyse, hostile } from './analysis';
import { BALANCED, Style, evaluate } from './evaluate';

// The generals' planner. All players move at once, so there is no turn tree to search: it builds
// candidate plans out of small tactics ("macros"), imagines plans for each rival the same way,
// plays every candidate against every scenario with the real rules (simulate) and keeps the
// plan with the best outcome.

/** Candidate plans weighed, rival scenarios each is played against, and randomness in the final pick. */
const LEVELS = {
  1: { plans: 3, scenarios: 1, noise: 14 },
  2: { plans: 10, scenarios: 4, noise: 4 },
  3: { plans: 26, scenarios: 8, noise: 0 },
} as const;

interface Ctx {
  state: GameState;
  board: Board;
  me: number;
  side: number;
  an: Analysis;
  style: Style;
  rng: Rng;
  armies: number[];
  /** Enemy army this plan marches on. */
  objective: number;
}

const power = (p: Piece) => PIECES[p.type].power;
const moveOrder = (p: Piece, to: number): Order => ({ k: 'move', army: p.army, type: p.type, from: p.loc, to });

function mine(c: Ctx, p: Piece): boolean {
  return c.state.armies[p.army].controller === c.me;
}
function myPowerAt(c: Ctx, d: OrderSheet, node: number): number {
  let total = 0;
  for (const p of d.preview.pieces) if (p.loc === node && mine(c, p)) total += power(p);
  return total;
}
/** My pieces on the board that can still be given a move order. */
function movable(c: Ctx, d: OrderSheet): Piece[] {
  return d.preview.pieces.filter(
    (p) => p.loc !== RESERVE && mine(c, p) && !p.moved && !p.fresh && PIECES[p.type].cls && d.left(p.army) > 0);
}
function canReach(c: Ctx, p: Piece, to: number): boolean {
  return c.board.canReach(PIECES[p.type].cls!, p.loc, to);
}
function pick<T>(rng: Rng, items: T[], weight: (item: T) => number): T | undefined {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return items[0];
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
function shuffled<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Macro = (c: Ctx, d: OrderSheet) => boolean;

/** Reinforce a threatened HQ from the Reserve, from nearby pieces or by buying. */
const defend: Macro = (c, d) => {
  let added = false;
  for (const a of c.armies) {
    const hq = c.board.hq[a];
    const threat = hostile(c.an, c.an.pot, hq, c.side, true);
    if (!threat) continue;
    const goal = threat * (c.rng() < 0.5 ? 1 : 0.6);
    let have = myPowerAt(c, d, hq);
    if (have > goal) continue;
    const helpers = d.preview.pieces
      .filter((p) => mine(c, p) && !p.moved && !p.fresh && PIECES[p.type].cls
        && (p.loc === RESERVE ? p.army === a : p.loc !== hq && canReach(c, p, hq)))
      .sort((x, y) => power(y) - power(x));
    for (const p of helpers) {
      if (have > goal) break;
      if (d.add(moveOrder(p, hq))) {
        have += power(p);
        added = true;
      }
    }
    const army = d.preview.armies[a];
    while (have <= goal && army.power >= 2 && d.left(a) >= 2) {
      const type = (['D', 'F', 'T', 'S'] as PieceType[]).find((t) => PIECES[t].power <= army.power)!;
      if (!d.add({ k: 'buy', army: a, type }) || !d.add({ k: 'move', army: a, type, from: RESERVE, to: hq })) break;
      have += PIECES[type].power;
      added = true;
    }
  }
  return added;
};

/** Converge on a space to overpower whoever stands there; on an enemy HQ, bring infantry for the flag. */
const attack: Macro = (c, d) => {
  const options: { node: number; force: Piece[]; weight: number }[] = [];
  const free = movable(c, d);
  for (let node = 0; node < c.board.numNodes; node++) {
    const info = c.board.nodes[node];
    const flagHere = info.kind === 'hq' && c.state.armies[info.army].alive && c.state.armies[info.army].controller !== c.me;
    let loot = 0;
    for (let s = 0; s < c.an.sides; s++) if (s !== c.side) loot += c.an.value[node][s];
    if (!loot && !flagHere) continue;

    const standing = hostile(c.an, c.an.power, node, c.side);
    const reinforcements = hostile(c.an, c.an.pot, node, c.side) - standing;
    const roll = c.rng();
    const margin = (roll < 0.4 ? 0 : roll < 0.75 ? 0.5 : 1) * reinforcements * Math.min(1, c.style.caution);
    const near = free
      .filter((p) => p.loc !== node && canReach(c, p, node))
      .sort((x, y) => power(y) - power(x));
    const force: Piece[] = [];
    let total = myPowerAt(c, d, node);
    let infantry = d.preview.pieces.some((p) => p.loc === node && mine(c, p) && PIECES[p.type].cls === 'inf');
    if (flagHere && !infantry) {
      const soldier = near.find((p) => PIECES[p.type].cls === 'inf');
      if (soldier) {
        force.push(soldier);
        total += power(soldier);
        infantry = true;
      }
    }
    for (const p of near) {
      if (total > standing + margin) break;
      if (force.includes(p)) continue;
      force.push(p);
      total += power(p);
    }
    if (total <= standing || !force.length) continue;
    // Drop whatever the attack does not need, smallest first.
    for (let i = force.length - 1; i >= 0; i--) {
      const p = force[i];
      const needed = flagHere && PIECES[p.type].cls === 'inf' && force.filter((q) => PIECES[q.type].cls === 'inf').length === 1;
      if (!needed && total - power(p) > standing + margin) {
        total -= power(p);
        force.splice(i, 1);
      }
    }
    if (!force.length) continue;
    const perArmy = new Map<number, number>();
    for (const p of force) perArmy.set(p.army, (perArmy.get(p.army) ?? 0) + 1);
    if ([...perArmy].some(([a, n]) => n > d.left(a))) continue;
    const prize = loot + (flagHere && infantry ? 400 : 0);
    if (prize <= 0) continue;
    const sure = total > standing + margin ? 1 : 0.5;
    options.push({ node, force, weight: (prize * sure) / Math.sqrt(force.length) });
  }
  const choice = pick(c.rng, options, (o) => o.weight * o.weight);
  if (!choice) return false;
  let added = false;
  for (const p of choice.force) added = d.add(moveOrder(p, choice.node)) || added;
  return added;
};

/** Put a piece on an enemy territory to collect Power. */
const income: Macro = (c, d) => {
  const targets = shuffled(c.rng, c.state.armies.filter((a) => a.alive && a.controller !== c.me).map((a) => a.id));
  const free = movable(c, d);
  const { nodes } = c.board;
  for (const t of targets) {
    if (d.preview.pieces.some((p) => mine(c, p) && p.loc !== RESERVE && nodes[p.loc].kind === 'sector' && nodes[p.loc].army === t)) continue;
    let best: { p: Piece; to: number; score: number } | undefined;
    for (const p of free) {
      for (const to of c.board.territory[t]) {
        if (!canReach(c, p, to)) continue;
        const strength = power(p) + myPowerAt(c, d, to);
        if (hostile(c.an, c.an.power, to, c.side) >= strength) continue;
        const safe = hostile(c.an, c.an.pot, to, c.side) <= strength;
        const score = (safe ? 10 : 0) - VALUE[p.type] * 0.3 + c.rng() * 2;
        if (!best || score > best.score) best = { p, to, score };
      }
    }
    if (best && d.add(moveOrder(best.p, best.to))) return true;
  }
  return false;
};

/** Trade up, spend Power and bring the Reserve onto the board. */
const develop: Macro = (c, d) => {
  let budget = 1 + Math.floor(c.rng() * 5);
  let added = false;
  const add = (order: Order) => {
    if (budget <= 0 || !d.add(order)) return false;
    budget--;
    added = true;
    return true;
  };
  const count = (army: number, type: PieceType, loc: number) =>
    d.preview.pieces.filter((p) => p.army === army && p.type === type && p.loc === loc).length;
  const tradeUps = (army: number) => {
    const spots = new Set(d.preview.pieces.filter((p) => p.army === army).map((p) => p.loc));
    for (const loc of spots)
      for (const type of GROUP1) while (count(army, type, loc) >= 3 && add({ k: 'up', army, type, at: loc }));
  };
  for (const a of shuffled(c.rng, c.armies)) {
    const army = d.preview.armies[a];
    const hq = c.board.hq[a];
    tradeUps(a);
    while (budget > 0 && army.power >= 2 && d.left(a) > 0) {
      const close = (t: PieceType) => (count(a, t, RESERVE) % 3 === 2 || count(a, t, hq) === 2 ? 4 : 0);
      const type = pick(c.rng, GROUP1.filter((t) => PIECES[t].power <= army.power), (t) =>
        t === 'S' || t === 'T' ? 3 + close(t) : t === 'F' ? 1.5 : 2)!;
      if (!add({ k: 'buy', army: a, type })) break;
      tradeUps(a);
    }
    const waiting = d.preview.pieces
      .filter((p) => p.army === a && p.loc === RESERVE && PIECES[p.type].cls)
      .sort((x, y) => power(y) - power(x));
    for (const p of waiting) {
      // Two of a kind may be worth holding back until a third can be bought.
      if (PIECES[p.type].group === 1 && count(a, p.type, RESERVE) === 2 && c.rng() < 0.6) continue;
      if (!add(moveOrder(p, hq))) break;
    }
    tradeUps(a);
  }
  return added;
};

/** Bring a third piece to a pair and trade the three up. */
const gather: Macro = (c, d) => {
  const free = movable(c, d);
  for (const a of shuffled(c.rng, c.armies)) {
    for (const type of shuffled(c.rng, GROUP1)) {
      const here = new Map<number, number>();
      for (const p of d.preview.pieces)
        if (p.army === a && p.type === type && p.loc !== RESERVE) here.set(p.loc, (here.get(p.loc) ?? 0) + 1);
      for (const [node, n] of here) {
        if (n !== 2 || d.left(a) < 2) continue;
        const third = free.find((p) => p.army === a && p.type === type && p.loc !== node && canReach(c, p, node));
        if (third && d.add(moveOrder(third, node))) {
          d.add({ k: 'up', army: a, type, at: node });
          return true;
        }
      }
    }
  }
  return false;
};

/** March towards the objective's HQ, keeping together and out of harm's way when possible. */
const advance: Macro = (c, d) => {
  const goal = c.board.hq[c.objective];
  const movers = movable(c, d).sort((x, y) => power(y) - power(x) + (c.rng() - 0.5) * 6);
  let quota = 1 + Math.floor(c.rng() * 3);
  let added = false;
  for (const p of movers) {
    if (quota <= 0) break;
    const cls = PIECES[p.type].cls!;
    const rounds = c.board.rounds[cls];
    const now = rounds[p.loc][goal];
    let best: { to: number; score: number } | undefined;
    for (const to of c.board.reach[cls][p.loc]) {
      const then = rounds[to][goal];
      if (then >= now) continue;
      const strength = power(p) + myPowerAt(c, d, to);
      if (hostile(c.an, c.an.power, to, c.side) >= strength) continue;
      const safe = hostile(c.an, c.an.pot, to, c.side) <= strength;
      const score = -then * 10 + (safe ? 6 * c.style.caution : 0) + (strength > power(p) ? 3 : 0) + c.rng() * 3;
      if (!best || score > best.score) best = { to, score };
    }
    if (best && d.add(moveOrder(p, best.to))) {
      quota--;
      added = true;
    }
  }
  return added;
};

/** Walk infantry towards the objective's HQ: nothing else can take a flag. */
const march: Macro = (c, d) => {
  const goal = c.board.hq[c.objective];
  const rounds = c.board.rounds.inf;
  const troops = movable(c, d)
    .filter((p) => PIECES[p.type].cls === 'inf')
    .sort((x, y) => rounds[x.loc][goal] - rounds[y.loc][goal] || power(y) - power(x));
  for (const p of troops.slice(0, 2)) {
    const now = rounds[p.loc][goal];
    let best: { to: number; score: number } | undefined;
    for (const to of c.board.reach.inf[p.loc]) {
      const then = rounds[to][goal];
      if (then >= now) continue;
      const strength = power(p) + myPowerAt(c, d, to);
      if (hostile(c.an, c.an.power, to, c.side) >= strength) continue;
      const safe = hostile(c.an, c.an.pot, to, c.side) <= strength;
      const score = -then * 10 + (safe ? 8 * c.style.caution : 0) + Math.min(strength, 30) * 0.2 + c.rng() * 2;
      if (!best || score > best.score) best = { to, score };
    }
    if (best && d.add(moveOrder(p, best.to))) return true;
  }
  return false;
};

/** Pull valuable pieces out of spaces the enemy could overpower. */
const retreat: Macro = (c, d) => {
  let added = false;
  const { nodes } = c.board;
  const free = movable(c, d).sort((x, y) => VALUE[y.type] - VALUE[x.type]);
  for (const p of free) {
    if (nodes[p.loc].kind === 'hq' && c.armies.includes(nodes[p.loc].army)) continue;
    if (hostile(c.an, c.an.pot, p.loc, c.side) <= myPowerAt(c, d, p.loc)) continue;
    let best: { to: number; score: number } | undefined;
    for (const to of c.board.reach[PIECES[p.type].cls!][p.loc]) {
      const strength = power(p) + myPowerAt(c, d, to);
      if (hostile(c.an, c.an.pot, to, c.side) > strength) continue;
      const home = nodes[to].kind === 'hq' && c.armies.includes(nodes[to].army);
      const score = (home ? 4 : 0) + Math.min(strength, 40) * 0.1 + c.rng() * 2;
      if (!best || score > best.score) best = { to, score };
    }
    if (best && d.add(moveOrder(p, best.to))) {
      added = true;
      if (c.rng() < 0.5) break;
    }
  }
  return added;
};

/** Launch a megamissile where it hurts most, building one first if the target is worth it. */
const missile: Macro = (c, d) => {
  for (const a of c.armies) {
    let best = { gain: 0, target: 0, targetArmy: -1 };
    for (let node = 0; node < c.board.numNodes; node++) {
      let gain = -2 * c.an.value[node][c.side];
      for (let s = 0; s < c.an.sides; s++) if (s !== c.side) gain += c.an.value[node][s] * (s === 0 ? 0.5 : 1);
      if (gain > best.gain) best = { gain, target: node, targetArmy: -1 };
    }
    for (const enemy of c.state.armies) {
      if (!enemy.alive || enemy.controller === c.me || enemy.controller === MERC) continue;
      let gain = enemy.power;
      for (const p of c.state.pieces) if (p.army === enemy.id && p.loc === RESERVE) gain += VALUE[p.type];
      if (gain > best.gain) best = { gain, target: RESERVE, targetArmy: enemy.id };
    }
    const ready = d.preview.pieces.find((p) => p.army === a && p.type === 'M');
    if (ready) {
      if (best.gain >= 30 && d.add({ k: 'launch', army: a, from: ready.loc, target: best.target, targetArmy: best.targetArmy }))
        return true;
      continue;
    }
    if (d.left(a) < 2) continue;
    const spots = new Set(d.preview.pieces.filter((p) => p.army === a && !(p.loc === c.board.hq[a])).map((p) => p.loc));
    spots.add(RESERVE);
    for (const loc of spots) {
      const recipe = cheapestMissileSpend(d.preview, a, loc);
      if (!recipe || best.gain < recipe.total * 1.15) continue;
      if (d.add({ k: 'mk', army: a, at: loc, spend: recipe.spend, power: recipe.power })) {
        d.add({ k: 'launch', army: a, from: loc, target: best.target, targetArmy: best.targetArmy });
        return true;
      }
    }
  }
  return false;
};

/** Three-player game: walk a mercenary piece into one of my stronger stacks to capture it. */
const hireMercenary: Macro = (c, d) => {
  let best: { p: Piece; to: number; score: number } | undefined;
  for (const p of d.preview.pieces) {
    if (c.state.armies[p.army].controller !== MERC || p.loc === RESERVE || p.moved || p.fresh || !PIECES[p.type].cls) continue;
    for (const to of c.board.reach[PIECES[p.type].cls!][p.loc]) {
      const mineThere = myPowerAt(c, d, to);
      if (!mineThere) continue;
      let others = power(p);
      for (let s = 0; s < c.an.sides; s++) if (s !== c.side) others = Math.max(others, c.an.power[to][s] + (s === 0 ? power(p) : 0));
      if (mineThere <= others) continue;
      const score = VALUE[p.type] + c.rng();
      if (!best || score > best.score) best = { p, to, score };
    }
  }
  return !!best && d.add(moveOrder(best.p, best.to));
};

/** Any legal order at all, so the plan is never empty (an empty plan costs a Power). */
function fallback(c: Ctx, d: OrderSheet): void {
  for (const p of shuffled(c.rng, movable(c, d))) {
    const options = c.board.reach[PIECES[p.type].cls!][p.loc].filter(
      (to) => hostile(c.an, c.an.power, to, c.side) < power(p) + myPowerAt(c, d, to));
    const to = pick(c.rng, options, () => 1);
    if (to !== undefined && d.add(moveOrder(p, to))) return;
  }
  for (const a of c.armies) {
    for (const p of d.preview.pieces) if (p.army === a && p.loc === RESERVE && PIECES[p.type].cls && d.add(moveOrder(p, c.board.hq[a]))) return;
    for (const type of GROUP1) if (d.add({ k: 'buy', army: a, type })) return;
    for (const type of GROUP1)
      for (const loc of new Set(d.preview.pieces.filter((p) => p.army === a).map((p) => p.loc)))
        if (d.add({ k: 'up', army: a, type, at: loc })) return;
  }
  for (const p of movable(c, d)) for (const to of c.board.reach[PIECES[p.type].cls!][p.loc]) if (d.add(moveOrder(p, to))) return;
}

function buildPlan(c: Ctx): Order[] {
  const d = new OrderSheet(c.state, c.me);
  const { aggression, caution, greed } = c.style;
  let macros: [Macro, number][] = [
    [attack, 3 * aggression], [income, 2.5 * greed], [develop, 2.5 * greed], [gather, 1.5],
    [advance, 1.5 * aggression], [march, 1.5 * aggression], [retreat, caution], [defend, 2.5 * caution], [missile, 1.5],
  ];
  if (c.state.armies.some((a) => a.alive && a.controller === MERC)) macros.push([hireMercenary, 2.5]);
  for (let step = 0; step < 16 && macros.length && !d.full; step++) {
    const entry = pick(c.rng, macros, (m) => m[1])!;
    if (!entry[0](c, d)) macros = macros.filter((m) => m !== entry);
  }
  if (!d.orders.length) fallback(c, d);
  return [...d.orders];
}

function context(state: GameState, an: Analysis, me: number, style: Style, rng: Rng): Ctx | null {
  const armies = livingArmies(state, me);
  if (!armies.length) return null;
  const board = boardOf(state);
  const enemies = state.armies.filter((a) => a.alive && a.controller !== me && a.controller !== MERC);
  const objective = pick(rng, enemies, (enemy) => {
    // Favour weak neighbours.
    let strength = enemy.power + 10;
    for (const p of state.pieces) if (p.army === enemy.id) strength += VALUE[p.type];
    const distance = Math.min(...armies.map((a) => board.rounds.air[board.hq[a]][board.hq[enemy.id]]));
    return 1000 / (strength * distance);
  });
  return { state, board, me, side: me + 1, an, style, rng, armies, objective: objective ? objective.id : armies[0] };
}

/** Chooses a player's orders. Awaits `checkpoint` between steps so the host stays responsive. */
export async function plan(
  state: GameState, me: number, level: BotLevel, style: Style, rng: Rng, checkpoint: () => Promise<void> = async () => {},
): Promise<Order[]> {
  const cfg = LEVELS[level];
  const an = analyse(state);

  const seen = new Set<string>();
  const plans: Order[][] = [];
  for (let i = 0; i < cfg.plans; i++) {
    const c = context(state, an, me, style, rng);
    if (!c) return [];
    const candidate = buildPlan(c);
    const key = JSON.stringify(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      plans.push(candidate);
    }
    await checkpoint();
  }
  if (plans.length === 1) return plans[0];

  // What the rivals might do: plans built the same way, from their point of view.
  const rivals = state.players.filter((p) => p.alive && p.id !== me);
  const scenarios: Order[][][] = [];
  for (let j = 0; j < cfg.scenarios; j++) {
    const scenario: Order[][] = state.players.map(() => []);
    for (const rival of rivals) {
      const c = context(state, an, rival.id, BALANCED, rng);
      if (c) scenario[rival.id] = buildPlan(c);
    }
    scenarios.push(scenario);
    await checkpoint();
  }

  const riskAversion = Math.min(0.5, 0.25 * style.caution);
  let best = plans[0];
  let bestScore = -Infinity;
  for (const candidate of plans) {
    let sum = 0;
    let worst = Infinity;
    for (const scenario of scenarios) {
      const outcome = simulate(state, scenario.map((o, p) => (p === me ? candidate : o)));
      const value = evaluate(outcome.state, me, style);
      sum += value;
      worst = Math.min(worst, value);
      await checkpoint();
    }
    const score = (sum / scenarios.length) * (1 - riskAversion) + worst * riskAversion + rng() * cfg.noise;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** A general: the planner with a temperament and a level. */
export class PlannerBot implements Bot {
  constructor(private readonly style: Style, private readonly level: BotLevel) {}

  decide(view: PlayerView, ctx: BotContext): Promise<Order[]> {
    return plan(view.state, view.me, this.level, this.style, ctx.rng, () => ctx.checkpoint());
  }
}

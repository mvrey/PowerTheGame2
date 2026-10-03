import { Bot, BotContext, BotLevel, Order, OrderSheet, PlayerView, ReadonlyGameState, Rng, simulate } from '../../api';
import { analyse } from './analysis';
import { BALANCED, Style, evaluate } from './evaluate';
import { PlanContext, createPlanContext } from './planContext';
import { pick } from './random';
import { fallback, weightedTactics } from './tactics';

// The generals' planner. All players move at once, so there is no turn tree to search: it builds
// candidate plans out of small tactics, imagines plans for each rival the same way, plays every
// candidate against every scenario with the real rules (simulate) and keeps the plan with the
// best outcome.

/** Candidate plans weighed, rival scenarios each is played against, and randomness in the final pick. */
const LEVELS = {
  1: { plans: 3, scenarios: 1, noise: 14 },
  2: { plans: 10, scenarios: 4, noise: 4 },
  3: { plans: 26, scenarios: 8, noise: 0 },
} as const;

/** Tactics tried per plan at most; a plan usually fills the order sheet well before. */
const MAX_TACTICS_PER_PLAN = 16;

function buildPlan(ctx: PlanContext): Order[] {
  const sheet = new OrderSheet(ctx.state, ctx.me);
  let tactics = weightedTactics(ctx);
  for (let step = 0; step < MAX_TACTICS_PER_PLAN && tactics.length && !sheet.full; step++) {
    const entry = pick(ctx.rng, tactics, ([, weight]) => weight)!;
    const [tactic] = entry;
    if (!tactic(ctx, sheet)) tactics = tactics.filter((t) => t !== entry);
  }
  if (!sheet.orders.length) fallback(ctx, sheet);
  return [...sheet.orders];
}

/** Chooses a player's orders. Awaits `checkpoint` between steps so the host stays responsive. */
export async function plan(
  state: ReadonlyGameState,
  me: number,
  level: BotLevel,
  style: Style,
  rng: Rng,
  checkpoint: () => Promise<void> = async () => {},
): Promise<Order[]> {
  const cfg = LEVELS[level];
  const analysis = analyse(state);

  const seen = new Set<string>();
  const plans: Order[][] = [];
  for (let i = 0; i < cfg.plans; i++) {
    const ctx = createPlanContext(state, analysis, me, style, rng);
    if (!ctx) return [];
    const candidate = buildPlan(ctx);
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
      const ctx = createPlanContext(state, analysis, rival.id, BALANCED, rng);
      if (ctx) scenario[rival.id] = buildPlan(ctx);
    }
    scenarios.push(scenario);
    await checkpoint();
  }

  // Cautious generals weigh the worst scenario more against the average one.
  const riskAversion = Math.min(0.5, 0.25 * style.caution);
  let best = plans[0];
  let bestScore = -Infinity;
  for (const candidate of plans) {
    let sum = 0;
    let worst = Infinity;
    for (const scenario of scenarios) {
      const outcome = simulate(
        state,
        scenario.map((orders, p) => (p === me ? candidate : orders)),
      );
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
  constructor(
    private readonly style: Style,
    private readonly level: BotLevel,
  ) {}

  decide(view: PlayerView, ctx: BotContext): Promise<Order[]> {
    return plan(view.state, view.me, this.level, this.style, ctx.rng, () => ctx.checkpoint());
  }
}

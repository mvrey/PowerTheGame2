import { MERC } from '../../../api';
import { PlanContext } from '../planContext';
import { defend, retreat } from './defence';
import { develop, gather, hireMercenary, income } from './economy';
import { advance, attack, march, missile } from './offence';
import { Tactic } from './tactic';

export type { Tactic } from './tactic';
export { fallback } from './fallback';

/** The tactics a plan is drawn from, each with its chance weighted by the general's temperament. */
export function weightedTactics(ctx: PlanContext): [Tactic, number][] {
  const { aggression, caution, greed } = ctx.style;
  const tactics: [Tactic, number][] = [
    [attack, 3 * aggression],
    [income, 2.5 * greed],
    [develop, 2.5 * greed],
    [gather, 1.5],
    [advance, 1.5 * aggression],
    [march, 1.5 * aggression],
    [retreat, caution],
    [defend, 2.5 * caution],
    [missile, 1.5],
  ];
  if (ctx.state.armies.some((a) => a.alive && a.controller === MERC)) tactics.push([hireMercenary, 2.5]);
  return tactics;
}

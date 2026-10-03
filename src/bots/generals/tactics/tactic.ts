import { OrderSheet } from '../../../api';
import { PlanContext } from '../planContext';

/**
 * A small piece of a plan: adds a few orders that serve one purpose to the sheet. Returns
 * whether it added any; a tactic that adds nothing is not tried again for this plan.
 */
export type Tactic = (ctx: PlanContext, sheet: OrderSheet) => boolean;

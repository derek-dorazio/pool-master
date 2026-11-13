import type { LeaguePlanListResponse } from '@/lib/api';
import { LEAGUE_PLAN_LABEL } from './plan-labels';

/**
 * The plan every new league is gifted, as the plan list names it (#1614): "Premium free for 6
 * months", or null while no preview is offered, so the offer disappears with it.
 */
export function previewOffer(list: Pick<LeaguePlanListResponse, 'previewPlan' | 'previewPeriodMonths'>): string | null {
  return list.previewPlan === null ? null : `${LEAGUE_PLAN_LABEL[list.previewPlan]} free for ${list.previewPeriodMonths} months`;
}

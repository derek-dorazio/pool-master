import type { LeaguePlanListResponse } from '@/lib/api';
import { formatCount } from '@/features/shared/ui';
import { LEAGUE_PLAN_LABEL } from './plan-labels';

/**
 * The plan every new league is gifted, as the plan list names it (#1614): "Premium free for 6
 * months", or null while no preview is offered, so the offer disappears with it.
 */
export function previewOffer(list: Pick<LeaguePlanListResponse, 'previewPlan' | 'previewPeriodMonths'>, locale: string): string | null {
  return list.previewPlan === null
    ? null
    : `${LEAGUE_PLAN_LABEL[list.previewPlan]} free for ${formatCount(list.previewPeriodMonths, 'month', locale)}`;
}

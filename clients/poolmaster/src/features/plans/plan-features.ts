import type { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import type { LeagueDto, LeaguePlanListResponse } from '@/lib/api';

/**
 * Whether the league's plan has `feature` (#948), read from the entitlements the league carries.
 * Views ask about their feature, never about a plan; the server refuses a locked one anyway. A
 * league still loading has none, so nothing locked is asked for before it arrives.
 */
export function hasPlanFeature(league: Pick<LeagueDto, 'planEntitlements'> | undefined, feature: PlanFeature): boolean {
  return league?.planEntitlements.features.includes(feature) ?? false;
}

/**
 * The lowest plan that includes any of `features`, for a locked section's "Included with …" line.
 * `plans` comes lowest first, as the plan list answers; null when no plan includes them.
 */
export function lowestPlanIncluding(
  plans: readonly Pick<LeaguePlanListResponse['plans'][number], 'features' | 'plan'>[],
  features: readonly PlanFeature[],
): LeaguePlan | null {
  return plans.find((plan) => features.some((feature) => plan.features.includes(feature)))?.plan ?? null;
}

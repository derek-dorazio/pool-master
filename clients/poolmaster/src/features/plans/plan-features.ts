import type { PlanFeature } from '@poolmaster/shared/domain';
import type { LeagueDto } from '@/lib/api';

/**
 * Whether the league's plan has `feature` (#948), read from the entitlements the league carries.
 * Views ask about their feature, never about a plan; the server refuses a locked one anyway. A
 * league still loading has none, so nothing locked is asked for before it arrives.
 */
export function hasPlanFeature(league: Pick<LeagueDto, 'planEntitlements'> | undefined, feature: PlanFeature): boolean {
  return league?.planEntitlements.features.includes(feature) ?? false;
}

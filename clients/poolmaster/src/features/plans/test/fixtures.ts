import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import type { PlanEntitlementsDto } from '@/lib/api';

/** A plan as the API returns it; by default Platinum with no limit set, every feature, and not offered to commissioners. */
export function buildPlanEntitlements(overrides: Partial<PlanEntitlementsDto> = {}): PlanEntitlementsDto {
  return {
    plan: LeaguePlan.PLATINUM,
    caps: { ENTRIES_PER_CONTEST: null, SPORTS_LEAGUES_PER_YEAR: null },
    features: Object.values(PlanFeature),
    commissionerSelectable: false,
    ...overrides,
  };
}

import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import type { PlanEntitlementsDto } from '@/lib/api';

/** A league's plan as the API returns it; Platinum, the default, has no limit and every feature. */
export function buildPlanEntitlements(overrides: Partial<PlanEntitlementsDto> = {}): PlanEntitlementsDto {
  return {
    plan: LeaguePlan.PLATINUM,
    caps: { ENTRIES_PER_CONTEST: null, SPORTS_LEAGUES_PER_YEAR: null },
    features: Object.values(PlanFeature),
    ...overrides,
  };
}

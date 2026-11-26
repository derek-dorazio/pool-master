import { LeaguePlan, PLAN_FEATURE_GROUP, PlanFeature, PlanFeatureGroup } from '@poolmaster/shared/domain';
import type { LeaguePlanListResponse, PlanEntitlementsDto, PlanFeatureGroupDto } from '@/lib/api';

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

/** The feature groups as the plans API sends them: each group with its features, in declaration order. */
export function buildPlanFeatureGroups(): PlanFeatureGroupDto[] {
  return Object.values(PlanFeatureGroup).map((group) => ({
    group,
    features: Object.values(PlanFeature).filter((feature) => PLAN_FEATURE_GROUP[feature] === group),
  }));
}

/** The plan list as the API returns it: the plans given, a six-month Premium preview, and the default expansion prices with payments off. */
export function buildPlanListResponse(
  plans: PlanEntitlementsDto[],
  overrides: Partial<Omit<LeaguePlanListResponse, 'plans'>> = {},
): LeaguePlanListResponse {
  const band = (entriesPerContest: number, dollars: number) => ({ entriesPerContest, priceCents: dollars * 100 });
  return {
    plans,
    featureGroups: buildPlanFeatureGroups(),
    previewPeriodMonths: 6,
    previewPlan: LeaguePlan.PREMIUM,
    paymentsEnabled: false,
    expansionPrices: {
      FREE: [band(50, 10), band(100, 20), band(200, 30), band(500, 40)],
      PRO: [band(100, 15), band(200, 20), band(500, 30)],
      PREMIUM: [band(200, 15), band(500, 20), band(1000, 30)],
      PLATINUM: [band(1000, 30), band(2000, 40)],
    },
    ...overrides,
  };
}

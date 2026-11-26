/**
 * Plan mappers (#945): a plan's entitlements → the DTO the app reads them from.
 */
import type { PlanEntitlementsDto, PlanFeatureGroupDto } from '@poolmaster/shared/dto';
import { PLAN_FEATURE_GROUP, PlanFeature, PlanFeatureGroup } from '@poolmaster/shared/domain';
import type { PlanEntitlements } from '../modules/plans/plan-entitlements-service';

export function toPlanEntitlementsDto(entitlements: PlanEntitlements): PlanEntitlementsDto {
  return {
    plan: entitlements.plan,
    caps: { ...entitlements.caps },
    features: Object.values(PlanFeature).filter((feature) => entitlements.features.has(feature)),
    commissionerSelectable: entitlements.commissionerSelectable,
  };
}

/** Each feature group with its features (#2110), from `PLAN_FEATURE_GROUP`; a group with none is left out. */
export function toPlanFeatureGroupDtos(): PlanFeatureGroupDto[] {
  return Object.values(PlanFeatureGroup)
    .map((group) => ({ group, features: Object.values(PlanFeature).filter((feature) => PLAN_FEATURE_GROUP[feature] === group) }))
    .filter((entry) => entry.features.length > 0);
}

/**
 * Plan mappers (#945): a plan's entitlements → the DTO the app reads them from.
 */
import type { PlanEntitlementsDto } from '@poolmaster/shared/dto';
import { PlanFeature } from '@poolmaster/shared/domain';
import type { PlanEntitlements } from '../modules/plans/plan-entitlements-service';

export function toPlanEntitlementsDto(entitlements: PlanEntitlements): PlanEntitlementsDto {
  return {
    plan: entitlements.plan,
    caps: { ...entitlements.caps },
    features: Object.values(PlanFeature).filter((feature) => entitlements.features.has(feature)),
  };
}

/**
 * Billing mappers — convert internal plan/usage/entitlement data to DTOs.
 */
import type {
  PlanResponse,
  PlansListResponse,
  UsageResponse,
  EntitlementsResponse,
  UsageDto,
} from '@poolmaster/shared/dto';

interface PlanTierRow {
  slug: string;
  name: string;
  displayOrder?: number | null;
  monthlyPriceCents?: number | null;
  annualPriceCents?: number | null;
  trialDays?: number | null;
  entitlements: Record<string, unknown>;
}

interface UsageItem {
  resource: string;
  current: number;
  limit: number;
  percentage: number;
}

export function toPlanResponse(planTier: PlanTierRow): PlanResponse {
  return {
    slug: planTier.slug,
    name: planTier.name,
    displayOrder: planTier.displayOrder ?? undefined,
    monthlyPriceCents: planTier.monthlyPriceCents ?? undefined,
    annualPriceCents: planTier.annualPriceCents ?? undefined,
    entitlements: planTier.entitlements,
  };
}

export function toPlansListResponse(tiers: PlanTierRow[]): PlansListResponse {
  return {
    plans: tiers.map((tier) => toPlanResponse(tier)),
  };
}

export function toUsageResponse(usage: {
  leagues: UsageItem;
  members: UsageItem;
  contests: UsageItem;
}): UsageResponse {
  return {
    usage: {
      leagues: toUsageDto(usage.leagues),
      members: toUsageDto(usage.members),
      contests: toUsageDto(usage.contests),
    },
  };
}

function toUsageDto(item: UsageItem): UsageDto {
  return {
    resource: item.resource,
    current: item.current,
    limit: item.limit,
    percentage: item.percentage,
  };
}

export function toEntitlementsResponse(
  entitlements: Record<string, unknown>,
): EntitlementsResponse {
  return { entitlements };
}

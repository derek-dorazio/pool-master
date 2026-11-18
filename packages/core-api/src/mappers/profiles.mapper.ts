/**
 * Tier and pricing profile mapper (#1844): a profile, with how many sport leagues name it.
 */
import type { PricingProfileDto, TierProfileDto } from '@poolmaster/shared/dto';
import type { PricingProfile, TierProfile } from '@poolmaster/shared/domain';

export function toTierProfileDto(profile: TierProfile, sportLeagueCount: number): TierProfileDto {
  return {
    id: profile.id,
    name: profile.name,
    tierCount: profile.tierCount,
    tierSize: profile.tierSize,
    lastTier: profile.lastTier,
    lastTierMax: profile.lastTierMax,
    sportLeagueCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function toPricingProfileDto(profile: PricingProfile, sportLeagueCount: number): PricingProfileDto {
  return {
    id: profile.id,
    name: profile.name,
    salaryCap: profile.salaryCap,
    unit: profile.unit,
    topSharePercent: profile.topSharePercent,
    floorSharePercent: profile.floorSharePercent,
    steepness: profile.steepness,
    sportLeagueCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

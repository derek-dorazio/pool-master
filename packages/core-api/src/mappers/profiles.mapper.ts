/**
 * Tier and pricing profile mapper (#1844): a profile, with how many sport leagues name it.
 */
import type { PlatformPricingProfileDto, PlatformTierProfileDto } from '@poolmaster/shared/dto';
import type { PlatformPricingProfile, PlatformTierProfile } from '@poolmaster/shared/domain';

export function toPlatformTierProfileDto(profile: PlatformTierProfile, sportLeagueCount: number): PlatformTierProfileDto {
  return {
    id: profile.id,
    code: profile.code,
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

export function toPlatformPricingProfileDto(profile: PlatformPricingProfile, sportLeagueCount: number): PlatformPricingProfileDto {
  return {
    id: profile.id,
    code: profile.code,
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

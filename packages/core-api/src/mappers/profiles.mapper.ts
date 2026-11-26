/**
 * Tier and pricing profile mapper (#1844): a profile, with how many sport leagues name it.
 */
import type { PlatformPricingProfileDto, PlatformTierProfileDto } from '@poolmaster/shared/dto';
import { TierProfileType, type PlatformPricingProfile, type PlatformTierProfile } from '@poolmaster/shared/domain';

export function toPlatformTierProfileDto(profile: PlatformTierProfile, sportLeagueCount: number): PlatformTierProfileDto {
  const saved = {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    sources: [...profile.sources],
    sportLeagueCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
  return profile.type === TierProfileType.RANGES
    ? { ...saved, type: TierProfileType.RANGES, ranges: profile.ranges.map(({ tierNumber, fromValue, toValue }) => ({ tierNumber, fromValue, toValue })) }
    : {
      ...saved,
      type: TierProfileType.EQUAL_GROUPS,
      tierCount: profile.tierCount,
      tierSize: profile.tierSize,
      lastTier: profile.lastTier,
      lastTierMax: profile.lastTierMax,
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
    sources: [...profile.sources],
    sportLeagueCount,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

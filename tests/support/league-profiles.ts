import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Sport } from '@poolmaster/shared/domain';

/**
 * The tier profile the migration points each sport's leagues at (#1844), by its code: each sport's
 * former code layout. A test league names the one its sport's leagues name, so it tiers as they do.
 */
export const SPORT_PLATFORM_TIER_PROFILE_CODE: Record<Sport, string> = {
  [Sport.GOLF]: 'TIERS_6_OF_10',
  [Sport.TENNIS]: 'TIERS_6_OF_8',
  [Sport.BASKETBALL]: 'TIERS_4_OF_16',
  [Sport.AMERICAN_FOOTBALL]: 'TIERS_7_OF_2',
  [Sport.BASEBALL]: 'TIERS_4_OF_3',
  [Sport.HOCKEY]: 'TIERS_4_OF_4',
  [Sport.SOCCER]: 'TIERS_4_OF_4',
  [Sport.AUTO_RACING]: 'TIERS_5_OF_8',
  [Sport.HORSE_RACING]: 'TIERS_3_OF_3',
  [Sport.CYCLING]: 'TIERS_5_OF_10',
  [Sport.RUNNING]: 'TIERS_4_OF_6',
};

/** The pricing profile every seeded sport league names, by its code. */
export const STANDARD_PLATFORM_PRICING_PROFILE_CODE = 'STANDARD';

/**
 * What a test sport league row needs beside its sport and name: the profile ids it names, a tier
 * profile by code (golf's by default) and Standard pricing, and a URL segment no other test's
 * league has (#2042).
 */
export async function sportLeagueRowDefaults(
  prisma: Pick<PrismaClient, 'platformTierProfile' | 'platformPricingProfile'>,
  platformTierProfileCode: string = SPORT_PLATFORM_TIER_PROFILE_CODE[Sport.GOLF],
): Promise<{ platformTierProfileId: string; platformPricingProfileId: string; urlSegment: string }> {
  const [platformTierProfile, platformPricingProfile] = await Promise.all([
    prisma.platformTierProfile.findUniqueOrThrow({ where: { code: platformTierProfileCode }, select: { id: true } }),
    prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: STANDARD_PLATFORM_PRICING_PROFILE_CODE }, select: { id: true } }),
  ]);
  return { platformTierProfileId: platformTierProfile.id, platformPricingProfileId: platformPricingProfile.id, urlSegment: `test-${randomUUID()}` };
}

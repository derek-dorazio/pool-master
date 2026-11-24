import type { PrismaClient } from '@prisma/client';
import { Sport } from '@poolmaster/shared/domain';

/**
 * The tier profile the migration points each sport's leagues at (#1844): each sport's former code
 * layout. A test league names the one its sport's leagues name, so it tiers as they do.
 */
export const SPORT_TIER_PROFILE_NAME: Record<Sport, string> = {
  [Sport.GOLF]: '6 tiers of 10',
  [Sport.TENNIS]: '6 tiers of 8',
  [Sport.BASKETBALL]: '4 tiers of 16',
  [Sport.AMERICAN_FOOTBALL]: '7 tiers of 2',
  [Sport.BASEBALL]: '4 tiers of 3',
  [Sport.HOCKEY]: '4 tiers of 4',
  [Sport.SOCCER]: '4 tiers of 4',
  [Sport.AUTO_RACING]: '5 tiers of 8',
  [Sport.HORSE_RACING]: '3 tiers of 3',
  [Sport.CYCLING]: '5 tiers of 10',
  [Sport.RUNNING]: '4 tiers of 6',
};

/** The profile ids a test sport league names: a tier profile by name (golf's by default) and Standard pricing. */
export async function leagueProfiles(
  prisma: Pick<PrismaClient, 'tierProfile' | 'pricingProfile'>,
  tierProfileName: string = SPORT_TIER_PROFILE_NAME[Sport.GOLF],
): Promise<{ tierProfileId: string; pricingProfileId: string }> {
  const [tierProfile, pricingProfile] = await Promise.all([
    prisma.tierProfile.findUniqueOrThrow({ where: { name: tierProfileName }, select: { id: true } }),
    prisma.pricingProfile.findUniqueOrThrow({ where: { name: 'Standard' }, select: { id: true } }),
  ]);
  return { tierProfileId: tierProfile.id, pricingProfileId: pricingProfile.id };
}

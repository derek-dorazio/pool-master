import type { PrismaClient } from '@prisma/client';
import { BracketAdvancement, type Sport } from '@poolmaster/shared/domain';
import { withCurrentSeason } from './event-edition';
import { SPORT_PLATFORM_TIER_PROFILE_CODE, sportLeagueRowDefaults } from './league-profiles';
import { sportPlay } from './sport-play';

/**
 * A test's own sport league, written as a migration writes one (#2075): there is no API that adds a
 * sport league, so a test that needs a league of its own inserts the row. It plays as its sport's
 * leagues do, names its sport's tier profile and Standard pricing, has a URL segment no other
 * test's league has, and starts with `championshipYear`'s Season (this year's by default) as its
 * current one, as the daily recompute would set it. Returns the row's id and name.
 */
export async function insertTestSportLeague(
  prisma: PrismaClient,
  input: { sport: Sport; name: string; timeZone?: string; bracketAdvancement?: BracketAdvancement; championshipYear?: number },
): Promise<{ id: string; name: string }> {
  const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: input.sport }, select: { id: true } });
  const league = await prisma.sportLeague.create({
    data: {
      ...(await sportLeagueRowDefaults(prisma, SPORT_PLATFORM_TIER_PROFILE_CODE[input.sport])),
      ...sportPlay(input.sport),
      sportId: sport.id,
      name: input.name,
      timeZone: input.timeZone ?? 'UTC',
      bracketAdvancement: input.bracketAdvancement ?? BracketAdvancement.FIXED,
    },
    select: { id: true, name: true },
  });
  await withCurrentSeason(prisma, league.id, input.championshipYear);
  return league;
}

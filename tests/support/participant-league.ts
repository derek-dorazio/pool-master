import type { PrismaClient } from '@prisma/client';
import type { Sport } from '@poolmaster/shared/domain';
import { sportLeagueRowDefaults } from './league-profiles';

/** What a participant's test sport league is named in each sport. */
export const TEST_PARTICIPANT_LEAGUE_NAME = 'Test participants';

/**
 * A sport league of the sport for a test's participants to belong to (#1853: every participant
 * belongs to one sport league), for a test whose participants need no particular league: a
 * contest, a field or a leaderboard read. One per sport, made on first use and found after, so a
 * suite's cleanup of participants and leagues leaves nothing behind it cannot remake. A test about
 * which league a participant is in makes its own league instead.
 */
export async function participantLeagueId(prisma: PrismaClient, sportId: string): Promise<string> {
  const where = { sportId_name: { sportId, name: TEST_PARTICIPANT_LEAGUE_NAME } };
  try {
    const league = await prisma.sportLeague.upsert({
      where,
      create: { ...(await sportLeagueRowDefaults(prisma)), sportId, name: TEST_PARTICIPANT_LEAGUE_NAME },
      update: {},
      select: { id: true },
    });
    return league.id;
  } catch (error) {
    // Two of a test's reads made it at once (a Promise.all): the one that lost finds the winner's.
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return (await prisma.sportLeague.findUniqueOrThrow({ where, select: { id: true } })).id;
  }
}

/** `participantLeagueId` for a sport named by its enum value; the sport's row must exist. */
export async function participantLeagueIdForSport(prisma: PrismaClient, sport: Sport): Promise<string> {
  const row = await prisma.sport.findUniqueOrThrow({ where: { sport }, select: { id: true } });
  return participantLeagueId(prisma, row.id);
}

import type { PrismaClient } from '@prisma/client';
import type { Sport } from '@poolmaster/shared/domain';

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
  const league = await prisma.sportLeague.upsert({
    where: { sportId_name: { sportId, name: TEST_PARTICIPANT_LEAGUE_NAME } },
    create: { sportId, name: TEST_PARTICIPANT_LEAGUE_NAME },
    update: {},
    select: { id: true },
  });
  return league.id;
}

/** `participantLeagueId` for a sport named by its enum value; the sport's row must exist. */
export async function participantLeagueIdForSport(prisma: PrismaClient, sport: Sport): Promise<string> {
  const row = await prisma.sport.findUniqueOrThrow({ where: { sport }, select: { id: true } });
  return participantLeagueId(prisma, row.id);
}

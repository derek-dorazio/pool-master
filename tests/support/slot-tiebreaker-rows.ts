import type { PrismaClient } from '@prisma/client';

/**
 * Makes a match written straight to the database its slot's tiebreaker game (#2048), as the rule
 * leaves it once a bracket load runs it: the match's Game 1, made in its round's slot when the
 * fixture made none, named on that slot. For fixtures that build matches row by row rather than
 * through the bracket service, which would queue the rule.
 */
export async function makeSlotTiebreaker(prisma: PrismaClient, sportEventRoundMatchId: string): Promise<string> {
  const match = await prisma.sportEventRoundMatch.findUniqueOrThrow({
    where: { id: sportEventRoundMatchId },
    select: { sportEventId: true, scheduledDate: true, sportEventRound: { select: { sportEventSlotId: true } }, games: { where: { gameNumber: 1 }, select: { id: true } } },
  });
  const gameId = match.games[0]?.id ?? (await prisma.sportEventRoundMatchGame.create({
    data: {
      sportEventId: match.sportEventId,
      sportEventRoundMatchId,
      sportEventSlotId: match.sportEventRound.sportEventSlotId,
      gameNumber: 1,
      scheduledDate: match.scheduledDate,
    },
    select: { id: true },
  })).id;
  await prisma.sportEventSlot.update({ where: { id: match.sportEventRound.sportEventSlotId }, data: { tiebreakerGameId: gameId } });
  return gameId;
}

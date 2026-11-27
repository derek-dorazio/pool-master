/**
 * A squares contest's Game row (#2050) for tests that seed a contest by hand: Game 1 of the
 * match, which every match has from the moment it is loaded. Test code only.
 */
import type { PrismaClient } from '@prisma/client';

export async function squaresGameCreate(prisma: PrismaClient, sportEventRoundMatchId: string): Promise<{ create: { sportEventRoundMatchGameId: string } }> {
  const game = await prisma.sportEventRoundMatchGame.findFirstOrThrow({ where: { sportEventRoundMatchId, gameNumber: 1 }, select: { id: true } });
  return { create: { sportEventRoundMatchGameId: game.id } };
}

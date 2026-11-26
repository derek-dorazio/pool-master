import { chooseSlotTiebreakerGame } from '@poolmaster/shared/domain';
import { PrismaSlotTiebreakerRepository } from '../../packages/core-api/src/adapters/prisma-slot-tiebreaker-repository';
import { getAppPrisma } from './helpers';

/**
 * Names each slot's tiebreaker game of an event by the rule (#2048), as the job a bracket load
 * queues leaves it, for fixtures that write an event's matches through the repository rather
 * than the bracket service. Writes no job, so a test that counts jobs sees only its own.
 */
export async function applySlotTiebreakerRule(sportEventId: string): Promise<void> {
  const slots = new PrismaSlotTiebreakerRepository(getAppPrisma());
  const writes = (await slots.findBySportEvent(sportEventId))
    .map((slot) => ({ sportEventSlotId: slot.sportEventSlotId, tiebreakerGameId: chooseSlotTiebreakerGame(slot.games)?.id ?? null, chosen: null }));
  await slots.saveTiebreakerGames(writes, []);
}

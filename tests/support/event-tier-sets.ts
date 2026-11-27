/**
 * Test-code fixtures for an event slot's team tier set (#2044): the slot an event's tiers and
 * valuations are written on below the API. Every template's starting point today is its event's
 * first slot; these fixtures' events cover one slot, so that slot is the first. An event a test
 * made below the API may cover none yet: a slot the sync keeps is linked to it then, so it stays
 * no test event.
 */
import type { PrismaClient } from '@prisma/client';
import { linkTestSlot } from './test-slots';

type Db = Parameters<typeof linkTestSlot>[0] & Pick<PrismaClient, 'sportEvent'>;

/** An event slot, as a valuation row names it: its id and its event's. */
export interface TierSetSlot {
  id: string;
  sportEventId: string;
}

/** The event's one slot, whose set its tiers and valuations go in; linked now when it has none. */
export async function tierSetSlot(prisma: Db, sportEventId: string): Promise<TierSetSlot> {
  const select = { id: true, sportEventId: true } as const;
  const slots = await prisma.sportEventSlot.findMany({ where: { sportEventId }, select });
  if (slots.length > 1) throw new Error(`Sport event ${sportEventId} has ${String(slots.length)} slots; tierSetSlot writes the set of an event with one.`);
  // poolmaster-allow-position: the event's one slot
  if (slots.length === 1) return slots[0];
  const event = await prisma.sportEvent.findUniqueOrThrow({ where: { id: sportEventId }, select: { id: true, sportLeagueSeasonId: true, startDate: true } });
  await linkTestSlot(prisma, event, false);
  return prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId }, select });
}

/** A valuation row's keys in the slot's set, for a create below the API. */
export function inTierSet(slot: TierSetSlot): { sportEventId: string; sportEventSlotId: string } {
  return { sportEventId: slot.sportEventId, sportEventSlotId: slot.id };
}

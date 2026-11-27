import { getEvent } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';

/**
 * The slot tier and price routes' path for an event's tier-set slot (#2044), read through the
 * API: the set the event read marks as its tier-set slot, the one a contest starting at the
 * event's first listed slot picks from.
 */
export async function tierSetSlotPath(client: Client, eventId: string): Promise<{ eventId: string; seasonSlotId: string }> {
  const { data } = await getEvent({ client, path: { eventId } });
  // poolmaster-allow-list-lookup: the event's own sets, one of which is its tier-set slot
  const set = data?.event.tierSets.find((each) => each.isTierSetSlot);
  if (set === undefined) throw new Error(`Event ${eventId} lists no tier-set slot.`);
  return { eventId, seasonSlotId: set.seasonSlotId };
}

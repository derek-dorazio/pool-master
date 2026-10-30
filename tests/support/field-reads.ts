import type { EventFieldReads } from '../../packages/core-api/src/modules/events/sport-event-participant-service';

/**
 * An event's field reads as a test double: the read now, the cached read (the same one unless
 * given) and the batched reads, which answer as the reads they batch.
 */
export function fieldReads(
  listEventParticipants: EventFieldReads['listEventParticipants'],
  listCachedEventParticipants: EventFieldReads['listCachedEventParticipants'] = listEventParticipants,
): EventFieldReads {
  const reads: EventFieldReads = { listEventParticipants, listCachedEventParticipants, batchedFieldReads: () => reads };
  return reads;
}

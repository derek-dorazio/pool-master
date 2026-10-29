/**
 * The event fields this container read in the last 30 seconds (#1163), keyed by sport event:
 * every contest on an event, and every viewer of its field, share one read of it. A write this
 * container makes to an event's field forgets it at once (the events routes and ingestion do);
 * other containers catch up within the TTL.
 */
import type { SportEventParticipantView } from '@poolmaster/shared/db';
import { readCacheTtlMs, type ReadCache } from '../../core/read-cache';

export type EventFieldCache = ReadCache<SportEventParticipantView[]>;

/** The TTL from `EVENT_FIELD_CACHE_TTL_MS`, in milliseconds, else 30 seconds; see `readCacheTtlMs`. */
export function readEventFieldCacheTtlMs(env: NodeJS.ProcessEnv): number {
  return readCacheTtlMs(env, 'EVENT_FIELD_CACHE_TTL_MS');
}

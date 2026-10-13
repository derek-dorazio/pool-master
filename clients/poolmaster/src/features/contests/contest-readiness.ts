import { getSportDefinition } from '@poolmaster/shared/domain';
import type { SportEventDto } from '@/lib/api';
import { countParticipants } from './contest-rules';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** "2d 14h", "5h 20m" or "12m": how long until a moment, for a countdown that needs no seconds. */
export function formatTimeUntil(target: string, now: Date = new Date()) {
  const remaining = new Date(target).getTime() - now.getTime();
  if (remaining <= 0) {
    return 'Closed';
  }
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((remaining % HOUR_MS) / 60_000);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "in 6 days", "tomorrow", "today": when an event starts, in whole days from now. */
export function formatStartsIn(startDate: string, now: Date = new Date()) {
  const days = Math.ceil((new Date(startDate).getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) {
    return 'today';
  }
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

export type ContestReadinessCheck = { id: string; isMet: boolean; label: string };

/**
 * What must hold before a contest can open to its league: the event is released with its field
 * and tiers loaded, and it has not started. These mirror the server's own checks, which still
 * have the last word.
 */
export function getContestReadinessChecks(event: SportEventDto, now: Date = new Date()): ContestReadinessCheck[] {
  const isReleased = event.readinessStatus !== 'NOT_RELEASED';
  const hasStarted = event.readinessStatus === 'EVENT_STARTED'
    || new Date(event.startDate).getTime() <= now.getTime();
  const { participant } = getSportDefinition(event.sport).vocabulary;
  const golfers = countParticipants(event.loadedParticipantCount, participant);
  const tiers = `${event.tierCount} tier${event.tierCount === 1 ? '' : 's'}`;

  return [
    {
      id: 'released',
      isMet: isReleased,
      label: isReleased ? 'Event released' : 'Event not released yet',
    },
    {
      id: 'field',
      isMet: event.loadedParticipantCount > 0 && event.tierCount > 0,
      label: event.loadedParticipantCount > 0
        ? `${golfers} in ${tiers}`
        : `No ${participant.many} loaded yet`,
    },
    {
      id: 'not-started',
      isMet: !hasStarted,
      label: hasStarted ? 'Event has started' : `Event starts ${formatStartsIn(event.startDate, now)}`,
    },
  ];
}

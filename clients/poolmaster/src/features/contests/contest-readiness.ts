import { countParticipants, eventSportDefinition, sportVocabulary } from '@poolmaster/shared/domain';
import type { SportEventDto } from '@/lib/api';

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
 * What must hold before a contest can open to its league, as the API reports it on the event: it
 * is released, its field is loaded, and it has not started. A second-chance bracket closes at its
 * starting round's first game instead (#721), so the event may be under way:
 * `secondChanceRoundName` names that round. The checks read the event's `readinessReasons`; the
 * server, which works them out, still has the last word when the contest opens.
 */
export function getContestReadinessChecks(
  event: SportEventDto,
  now: Date = new Date(),
  secondChanceRoundName: string | null = null,
): ContestReadinessCheck[] {
  const isReleased = !event.readinessReasons.includes('EVENT_NOT_RELEASED');
  const hasField = !event.readinessReasons.includes('FIELD_NOT_LOADED');
  const hasStarted = event.readinessReasons.includes('EVENT_STARTED');
  const { participant } = sportVocabulary(eventSportDefinition(event));
  const golfers = countParticipants(event.participantCount, participant);
  const tiers = `${event.tierCount} tier${event.tierCount === 1 ? '' : 's'}`;

  return [
    {
      id: 'released',
      isMet: isReleased,
      label: isReleased ? 'Event released' : 'Event not released yet',
    },
    {
      id: 'field',
      isMet: hasField,
      label: !hasField
        ? `No ${participant.many} loaded yet`
        : event.tierCount > 0 ? `${golfers} in ${tiers}` : golfers,
    },
    hasStarted && secondChanceRoundName !== null
      ? { id: 'not-started', isMet: true, label: `Event under way · the bracket starts at the ${secondChanceRoundName}` }
      : {
        id: 'not-started',
        isMet: !hasStarted,
        label: hasStarted ? 'Event has started' : `Event starts ${formatStartsIn(event.startDate, now)}`,
      },
  ];
}

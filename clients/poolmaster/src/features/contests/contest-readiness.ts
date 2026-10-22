import { SportEventStatus, TournamentFormat, getSportDefinition, countParticipants  } from '@poolmaster/shared/domain';
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
 * Whether an event is a knockout under way that a second-chance bracket could still start on
 * (#721): released with its field loaded, and in progress, which is the only reason it is not
 * contest-ready. Whether its later round is still ahead with its teams decided is the server's to
 * say when the contest is created.
 */
export function isKnockoutUnderWay(event: SportEventDto) {
  return getSportDefinition(event.sport).tournamentFormat === TournamentFormat.MATCHES
    && event.status === SportEventStatus.IN_PROGRESS
    && event.readinessReasons.length > 0
    && event.readinessReasons.every((reason) => reason === 'EVENT_STARTED');
}

/**
 * What must hold before a contest can open to its league: the event is released with its field
 * and tiers loaded, and it has not started. A second-chance bracket closes at its starting
 * round's first game instead (#721), so the event may be under way: `secondChanceRoundName` names
 * that round. These mirror the server's own checks, which still have the last word.
 */
export function getContestReadinessChecks(
  event: SportEventDto,
  now: Date = new Date(),
  secondChanceRoundName: string | null = null,
): ContestReadinessCheck[] {
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
    hasStarted && secondChanceRoundName !== null
      ? { id: 'not-started', isMet: true, label: `Event under way · the bracket starts at the ${secondChanceRoundName}` }
      : {
        id: 'not-started',
        isMet: !hasStarted,
        label: hasStarted ? 'Event has started' : `Event starts ${formatStartsIn(event.startDate, now)}`,
      },
  ];
}

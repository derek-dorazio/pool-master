/**
 * When a sport event's results are overdue (#1865): it was released, is neither completed nor
 * cancelled, and its last round or match should have ended more than OVERDUE_AFTER_MS ago. The Sports page's
 * overview and the League page's events read both judge it here, from the same facts.
 */
import { FINISHED_SPORT_EVENT_STATUSES, SportEventStatus, type Sport } from './enums';

/** How long after its expected end an event's missing results count as overdue: 4 hours (Derek, 2026-11-18). */
export const OVERDUE_AFTER_MS = 4 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/**
 * Statuses never overdue: a never-released draft, which no contest can use (#1908), and an event
 * whose results are in or will never come. A reader skips them too.
 */
export const NEVER_OVERDUE_STATUSES: readonly SportEventStatus[] = [
  SportEventStatus.DRAFT,
  ...FINISHED_SPORT_EVENT_STATUSES,
];

/** One round as scheduled, with the latest scheduled start of its matches. */
export interface OverdueRoundFacts {
  scheduledDate: Date;
  scheduledEndAt: Date | null;
  latestMatchStart: Date | null;
}

/** What it takes to judge one event. */
export interface OverdueEventFacts {
  id: string;
  name: string;
  sport: Sport;
  status: SportEventStatus;
  startDate: Date;
  endDate: Date | null;
  rounds: OverdueRoundFacts[];
  /**
   * How long one of its games usually takes from its scheduled start, in minutes: its sport
   * league's selected provider league's (#1997). Null when its league syncs from none.
   */
  typicalGameMinutes: number | null;
}

/**
 * When the event should have ended: its last round's scheduled end, or for a round with none the
 * later of its start and its last match's start plus its typical game length. With no rounds,
 * its own end date, else its start plus the typical game length. Null when that takes a typical
 * game length the event does not have: its end is not known, so it is never overdue.
 */
export function expectedEndOf(event: OverdueEventFacts): Date | null {
  const play = event.typicalGameMinutes === null ? null : event.typicalGameMinutes * MINUTE_MS;
  if (event.rounds.length === 0) {
    if (event.endDate !== null) return event.endDate;
    return play === null ? null : new Date(event.startDate.getTime() + play);
  }
  const ends: number[] = [];
  for (const round of event.rounds) {
    if (round.scheduledEndAt !== null) {
      ends.push(round.scheduledEndAt.getTime());
      continue;
    }
    if (play === null) return null;
    ends.push(Math.max(round.scheduledDate.getTime(), round.latestMatchStart?.getTime() ?? 0) + play);
  }
  return new Date(Math.max(...ends));
}

/**
 * When an overdue event should have ended, or null while its results are not overdue: a
 * never-released draft, a completed or a cancelled event never is, and any other is once its expected end is more than
 * OVERDUE_AFTER_MS behind `now`. How late it is runs from the time this returns.
 */
export function overdueExpectedEnd(event: OverdueEventFacts, now: Date): Date | null {
  if (NEVER_OVERDUE_STATUSES.includes(event.status)) return null;
  const expectedEnd = expectedEndOf(event);
  if (expectedEnd === null) return null;
  return now.getTime() - expectedEnd.getTime() > OVERDUE_AFTER_MS ? expectedEnd : null;
}

/**
 * The earliest start an event may have and still be overdue at `now`: every expected end is at
 * or after the start, so a reader need only look at events that started before this.
 */
export function overdueStartCutoff(now: Date): Date {
  return new Date(now.getTime() - OVERDUE_AFTER_MS);
}

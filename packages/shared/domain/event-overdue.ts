/**
 * When a sport event's results are overdue (#1865): it was released, is neither completed nor
 * cancelled, and its last round or match should have ended more than OVERDUE_AFTER_MS ago. The Sports page's
 * overview and the League page's events read both judge it here, from the same facts.
 */
import { FINISHED_SPORT_EVENT_STATUSES, Sport, SportEventStatus } from './enums';

/** How long after its expected end an event's missing results count as overdue: 4 hours (Derek, 2026-11-18). */
export const OVERDUE_AFTER_MS = 4 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long a sport's game, race or round usually takes from its scheduled start, for a round or
 * match with no scheduled end: a start plus this is when it should have ended.
 */
export const SPORT_TYPICAL_PLAY_MS: Readonly<Record<Sport, number>> = {
  [Sport.AMERICAN_FOOTBALL]: 3.5 * HOUR_MS,
  [Sport.BASKETBALL]: 2.5 * HOUR_MS,
  [Sport.BASEBALL]: 3 * HOUR_MS,
  [Sport.HOCKEY]: 2.5 * HOUR_MS,
  [Sport.SOCCER]: 2 * HOUR_MS,
  [Sport.TENNIS]: 3 * HOUR_MS,
  [Sport.GOLF]: 6 * HOUR_MS,
  [Sport.AUTO_RACING]: 2 * HOUR_MS,
  [Sport.HORSE_RACING]: 0.5 * HOUR_MS,
  [Sport.CYCLING]: 5 * HOUR_MS,
  [Sport.RUNNING]: 3 * HOUR_MS,
};

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

/**
 * What it takes to judge one event. A Clutch Card event's rounds are the rounds of its parent
 * event it covers, since it plays none of its own (#1820).
 */
export interface OverdueEventFacts {
  id: string;
  name: string;
  sport: Sport;
  status: SportEventStatus;
  startDate: Date;
  endDate: Date | null;
  rounds: OverdueRoundFacts[];
}

/**
 * When the event should have ended: its last round's scheduled end, or for a round with none the
 * later of its start and its last match's start plus the sport's typical play. With no rounds,
 * its own end date, else its start plus the typical play.
 */
export function expectedEndOf(event: OverdueEventFacts): Date {
  const play = SPORT_TYPICAL_PLAY_MS[event.sport];
  if (event.rounds.length === 0) {
    return event.endDate ?? new Date(event.startDate.getTime() + play);
  }
  const ends = event.rounds.map((round) => {
    if (round.scheduledEndAt !== null) return round.scheduledEndAt.getTime();
    const lastStart = Math.max(round.scheduledDate.getTime(), round.latestMatchStart?.getTime() ?? 0);
    return lastStart + play;
  });
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
  return now.getTime() - expectedEnd.getTime() > OVERDUE_AFTER_MS ? expectedEnd : null;
}

/**
 * The earliest start an event may have and still be overdue at `now`: every expected end is at
 * or after the start, so a reader need only look at events that started before this.
 */
export function overdueStartCutoff(now: Date): Date {
  return new Date(now.getTime() - OVERDUE_AFTER_MS);
}

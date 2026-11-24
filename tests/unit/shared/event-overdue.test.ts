/**
 * When a sport event's results are overdue (#1865): released, and neither completed nor cancelled
 * more than 4 hours after its last round or match should have ended. A never-released draft never
 * is (#1908).
 */
import { expect } from '@jest/globals';
import {
  expectedEndOf,
  OVERDUE_AFTER_MS,
  overdueExpectedEnd,
  overdueStartCutoff,
  Sport,
  SportEventStatus,
  type OverdueEventFacts,
} from '@poolmaster/shared/domain';

const at = (iso: string) => new Date(iso);
const MINUTE = 60 * 1000;
/** The event's league's typical game length, from its selected provider league. */
const TYPICAL_MINUTES = 150;

function event(overrides: Partial<OverdueEventFacts> = {}): OverdueEventFacts {
  return {
    id: 'e1', name: 'Game 1', sport: Sport.BASKETBALL, status: SportEventStatus.IN_PROGRESS,
    startDate: at('2026-11-18T00:00:00.000Z'), endDate: null, rounds: [], typicalGameMinutes: TYPICAL_MINUTES, ...overrides,
  };
}

describe('expectedEndOf', () => {
  it('takes a round\'s scheduled end, the latest of all its rounds', () => {
    const facts = event({
      rounds: [
        { scheduledDate: at('2026-11-18T00:00:00.000Z'), scheduledEndAt: at('2026-11-18T05:00:00.000Z'), latestMatchStart: null },
        { scheduledDate: at('2026-11-19T00:00:00.000Z'), scheduledEndAt: at('2026-11-19T06:00:00.000Z'), latestMatchStart: null },
      ],
    });

    expect(expectedEndOf(facts)).toEqual(at('2026-11-19T06:00:00.000Z'));
  });

  it('adds the league\'s typical game length to the later of a round\'s start and its last match\'s start when the round has no end', () => {
    const facts = event({
      rounds: [{ scheduledDate: at('2026-11-18T00:00:00.000Z'), scheduledEndAt: null, latestMatchStart: at('2026-11-18T03:00:00.000Z') }],
    });

    expect(expectedEndOf(facts)?.getTime()).toBe(at('2026-11-18T03:00:00.000Z').getTime() + TYPICAL_MINUTES * MINUTE);
  });

  it('falls back to the event\'s own end date, then its start plus the typical game length, when it has no rounds', () => {
    expect(expectedEndOf(event({ endDate: at('2026-11-20T00:00:00.000Z') }))).toEqual(at('2026-11-20T00:00:00.000Z'));
    expect(expectedEndOf(event())?.getTime()).toBe(at('2026-11-18T00:00:00.000Z').getTime() + TYPICAL_MINUTES * MINUTE);
  });

  it('knows no end, so the event is never overdue, when it needs a typical game length its league has none of', () => {
    const unsynced = event({ typicalGameMinutes: null });
    const roundWithoutEnd = event({
      typicalGameMinutes: null,
      rounds: [
        { scheduledDate: at('2026-11-18T00:00:00.000Z'), scheduledEndAt: at('2026-11-18T05:00:00.000Z'), latestMatchStart: null },
        { scheduledDate: at('2026-11-19T00:00:00.000Z'), scheduledEndAt: null, latestMatchStart: null },
      ],
    });

    expect(expectedEndOf(unsynced)).toBeNull();
    expect(expectedEndOf(roundWithoutEnd)).toBeNull();
    expect(overdueExpectedEnd(unsynced, at('2027-01-01T00:00:00.000Z'))).toBeNull();
    expect(expectedEndOf(event({ typicalGameMinutes: null, endDate: at('2026-11-20T00:00:00.000Z') }))).toEqual(at('2026-11-20T00:00:00.000Z'));
  });
});

describe('overdueExpectedEnd', () => {
  const end = at('2026-11-18T10:00:00.000Z');
  const ended = event({ endDate: end });

  it('marks an event overdue once its expected end is more than 4 hours behind, answering that end', () => {
    expect(overdueExpectedEnd(ended, new Date(end.getTime() + OVERDUE_AFTER_MS + MINUTE))).toEqual(end);
  });

  it('does not mark it overdue at 3 hours 59 minutes, nor at exactly 4 hours', () => {
    expect(overdueExpectedEnd(ended, new Date(end.getTime() + OVERDUE_AFTER_MS - MINUTE))).toBeNull();
    expect(overdueExpectedEnd(ended, new Date(end.getTime() + OVERDUE_AFTER_MS))).toBeNull();
  });

  it('never marks a completed or cancelled event overdue', () => {
    const later = new Date(end.getTime() + 10 * OVERDUE_AFTER_MS);

    expect(overdueExpectedEnd(event({ endDate: end, status: SportEventStatus.COMPLETED }), later)).toBeNull();
    expect(overdueExpectedEnd(event({ endDate: end, status: SportEventStatus.CANCELLED }), later)).toBeNull();
    expect(overdueExpectedEnd(event({ endDate: end, status: SportEventStatus.SCHEDULED }), later)).toEqual(end);
  });

  it('never marks a never-released draft overdue, however long ago it should have ended', () => {
    const muchLater = new Date(end.getTime() + 100 * OVERDUE_AFTER_MS);

    expect(overdueExpectedEnd(event({ endDate: end, status: SportEventStatus.DRAFT }), muchLater)).toBeNull();
  });

  it('reads only events that started more than 4 hours before now', () => {
    const now = at('2026-11-19T12:00:00.000Z');

    expect(overdueStartCutoff(now)).toEqual(new Date(now.getTime() - OVERDUE_AFTER_MS));
  });
});

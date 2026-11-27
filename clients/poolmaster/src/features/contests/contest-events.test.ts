import { describe, expect, it } from 'vitest';
import {
  entryEventStatus,
  eventOfCurrentSlot,
  eventOfFirstSlot,
  eventOfLastSlot,
  eventOfSlot,
  hasContestEventStarted,
} from './contest-events';
import { buildContestSportEvent } from './test/contest-admin-fixtures';
import { coverageOfEvents } from './test/covered-slots';

const NOW = new Date('2026-09-15T12:00:00.000Z');

const week1 = buildContestSportEvent({ sportEventId: 'week-1', name: 'Week 1', startDate: '2026-09-06T17:00:00.000Z', status: 'COMPLETED' });
const week2 = buildContestSportEvent({ sportEventId: 'week-2', name: 'Week 2', startDate: '2026-09-20T17:00:00.000Z' });
const week3 = buildContestSportEvent({ sportEventId: 'week-3', name: 'Week 3', startDate: '2026-09-27T17:00:00.000Z' });

describe('hasContestEventStarted', () => {
  it('counts a scheduled event as started once its start time has passed, though its status still says scheduled', () => {
    expect(hasContestEventStarted({ startDate: '2026-09-15T11:59:00.000Z', status: 'SCHEDULED' }, NOW)).toBe(true);
  });

  it('counts an event starting at this very moment as started', () => {
    expect(hasContestEventStarted({ startDate: NOW.toISOString(), status: 'SCHEDULED' }, NOW)).toBe(true);
  });

  it('counts a scheduled event whose start is still ahead as not started', () => {
    expect(hasContestEventStarted({ startDate: '2026-09-15T12:01:00.000Z', status: 'SCHEDULED' }, NOW)).toBe(false);
  });

  it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const)(
    'counts an event whose status is %s as started even when its start time is still ahead',
    (status) => {
      expect(hasContestEventStarted({ startDate: '2099-01-01T00:00:00.000Z', status }, NOW)).toBe(true);
    },
  );

  it.each(['DRAFT', 'POSTPONED'] as const)(
    'counts a %s event whose start time is still ahead as not started',
    (status) => {
      expect(hasContestEventStarted({ startDate: '2099-01-01T00:00:00.000Z', status }, NOW)).toBe(false);
    },
  );
});

describe('the contest\'s current slot and its event', () => {
  it('opens on the event that plays the covered slot the API names current', () => {
    const sportEvents = [week1, week2, week3];
    const contest = { sportEvents, ...coverageOfEvents({ sportEvents }), currentSlotId: 'slot-week-2' };

    expect(eventOfCurrentSlot(contest)?.sportEventId).toBe('week-2');
  });

  it('names no current event when the API names no current slot', () => {
    const sportEvents = [week1];
    const contest = { sportEvents, ...coverageOfEvents({ sportEvents }), currentSlotId: null };

    expect(eventOfCurrentSlot(contest)).toBeNull();
  });
});

describe('eventOfFirstSlot and eventOfLastSlot', () => {
  it('name the events of the contest\'s first and last covered slots, in play order', () => {
    const sportEvents = [week1, week2, week3];
    const contest = { sportEvents, ...coverageOfEvents({ sportEvents }) };

    expect(eventOfFirstSlot(contest)?.sportEventId).toBe('week-1');
    expect(eventOfLastSlot(contest)?.sportEventId).toBe('week-3');
  });

  it('name one event for both when several covered slots are rounds of one event', () => {
    const sportEvents = [week1];
    const [round] = coverageOfEvents({ sportEvents }).coveredSlots;
    const rounds = [round, { ...round, seasonSlotId: 'slot-r2' }];

    expect(eventOfFirstSlot({ sportEvents, coveredSlots: rounds })?.sportEventId).toBe('week-1');
    expect(eventOfLastSlot({ sportEvents, coveredSlots: rounds })?.sportEventId).toBe('week-1');
  });

  it('return null for a contest that covers no slot, or a slot no event plays yet', () => {
    const [slot] = coverageOfEvents({ sportEvents: [week1] }).coveredSlots;

    expect(eventOfFirstSlot({ sportEvents: [], coveredSlots: [] })).toBeNull();
    expect(eventOfLastSlot({ sportEvents: [], coveredSlots: [] })).toBeNull();
    expect(eventOfSlot({ sportEvents: [week1] }, { ...slot, sportEventId: null })).toBeNull();
  });
});

describe('entryEventStatus', () => {
  const entry = {
    events: [
      { sportEventId: 'week-1', status: 'SUBMITTED' as const, submittedAt: '2026-09-05T00:00:00.000Z' },
      { sportEventId: 'week-2', status: 'DRAFT' as const, submittedAt: null },
    ],
  };

  it('reads the entry\'s own status in the named event', () => {
    expect(entryEventStatus(entry, 'week-1')).toBe('SUBMITTED');
    expect(entryEventStatus(entry, 'week-2')).toBe('DRAFT');
  });

  it('defaults to DRAFT for an event the entry has no status in yet', () => {
    expect(entryEventStatus(entry, 'week-3')).toBe('DRAFT');
  });

  it('defaults to DRAFT when no event is named', () => {
    expect(entryEventStatus(entry, null)).toBe('DRAFT');
    expect(entryEventStatus(entry, undefined)).toBe('DRAFT');
  });
});

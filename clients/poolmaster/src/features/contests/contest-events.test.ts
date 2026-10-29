import { describe, expect, it } from 'vitest';
import { SelectionType } from '@poolmaster/shared/domain';
import {
  coversOneEvent,
  currentContestEvent,
  entryEventStatus,
  firstContestEvent,
  hasContestEventStarted,
  lastContestEvent,
} from './contest-events';
import { buildContestSportEvent } from './test/contest-admin-fixtures';

const NOW = new Date('2026-09-15T12:00:00.000Z');

const week1 = buildContestSportEvent({ sportEventId: 'week-1', sequence: 1, name: 'Week 1', startDate: '2026-09-06T17:00:00.000Z', status: 'COMPLETED' });
const week2 = buildContestSportEvent({ sportEventId: 'week-2', sequence: 2, name: 'Week 2', startDate: '2026-09-20T17:00:00.000Z' });
const week3 = buildContestSportEvent({ sportEventId: 'week-3', sequence: 3, name: 'Week 3', startDate: '2026-09-27T17:00:00.000Z' });

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

describe('currentContestEvent', () => {
  it('opens on the first event that has not started, skipping the ones already played', () => {
    expect(currentContestEvent({ sportEvents: [week1, week2, week3] }, NOW)?.sportEventId).toBe('week-2');
  });

  it('opens on the first event when none has started yet', () => {
    expect(currentContestEvent({ sportEvents: [week2, week3] }, NOW)?.sportEventId).toBe('week-2');
  });

  it('opens on the last event once every event has started', () => {
    const later = new Date('2026-10-01T00:00:00.000Z');
    expect(currentContestEvent({ sportEvents: [week1, week2, week3] }, later)?.sportEventId).toBe('week-3');
  });

  it('returns null for a contest with no events', () => {
    expect(currentContestEvent({ sportEvents: [] }, NOW)).toBeNull();
  });
});

describe('firstContestEvent and lastContestEvent', () => {
  it('name the contest\'s first and last events in its order', () => {
    expect(firstContestEvent({ sportEvents: [week1, week2, week3] })?.sportEventId).toBe('week-1');
    expect(lastContestEvent({ sportEvents: [week1, week2, week3] })?.sportEventId).toBe('week-3');
  });

  it('return null for a contest with no events', () => {
    expect(firstContestEvent({ sportEvents: [] })).toBeNull();
    expect(lastContestEvent({ sportEvents: [] })).toBeNull();
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

describe('coversOneEvent', () => {
  it('holds a random draw and a bracket to one event, so neither offers to add events, while the other types may cover several', () => {
    expect(coversOneEvent(SelectionType.RANDOM_DRAW)).toBe(true);
    expect(coversOneEvent(SelectionType.BRACKET)).toBe(true);
    expect(coversOneEvent(SelectionType.TIERED)).toBe(false);
    expect(coversOneEvent(SelectionType.BUDGET_PICK)).toBe(false);
    expect(coversOneEvent(SelectionType.PICK_EM)).toBe(false);
  });
});

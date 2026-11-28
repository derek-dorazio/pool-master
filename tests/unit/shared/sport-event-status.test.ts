/**
 * The one home for what an event's status says (#1929): started, finished, not over, and whether
 * the event is past its contest cutoff. The server and the web both read these.
 */
import { describe, expect, it } from '@jest/globals';
import {
  FINISHED_SPORT_EVENT_STATUSES,
  hasSportEventStarted,
  isSportEventStatusFinished,
  isSportEventStatusStarted,
  NOT_OVER_SPORT_EVENT_STATUSES,
  SportEventStatus,
  STARTED_SPORT_EVENT_STATUSES,
} from '@poolmaster/shared/domain';

const ALL = Object.values(SportEventStatus);

describe('sport event status sets', () => {
  it('counts an event under way, completed or cancelled as started, and a draft, scheduled or postponed one as not', () => {
    expect(ALL.filter(isSportEventStatusStarted).sort()).toEqual(['CANCELLED', 'COMPLETED', 'IN_PROGRESS']);
    expect([...STARTED_SPORT_EVENT_STATUSES].sort()).toEqual(['CANCELLED', 'COMPLETED', 'IN_PROGRESS']);
  });

  it('counts only completed and cancelled as finished', () => {
    expect(ALL.filter(isSportEventStatusFinished).sort()).toEqual(['CANCELLED', 'COMPLETED']);
    expect([...FINISHED_SPORT_EVENT_STATUSES].sort()).toEqual(['CANCELLED', 'COMPLETED']);
  });

  it('counts every status but completed and cancelled as not over, so the two sets split every status between them', () => {
    expect([...NOT_OVER_SPORT_EVENT_STATUSES].sort()).toEqual(['DRAFT', 'IN_PROGRESS', 'SCHEDULED']);
    expect([...NOT_OVER_SPORT_EVENT_STATUSES, ...FINISHED_SPORT_EVENT_STATUSES].sort()).toEqual([...ALL].sort());
  });
});

describe('hasSportEventStarted', () => {
  const now = new Date('2026-04-01T12:00:00.000Z');
  const beforeStart = new Date('2026-04-10T12:00:00.000Z');

  it('is false for a draft or scheduled event whose start is still ahead', () => {
    expect(hasSportEventStarted({ status: 'SCHEDULED', startDate: beforeStart }, now)).toBe(false);
    expect(hasSportEventStarted({ status: 'DRAFT', startDate: beforeStart }, now)).toBe(false);
  });

  it('is true at the start time, and for an event in progress, completed or cancelled whatever its start', () => {
    expect(hasSportEventStarted({ status: 'SCHEDULED', startDate: now }, now)).toBe(true);
    expect(hasSportEventStarted({ status: 'IN_PROGRESS', startDate: beforeStart }, now)).toBe(true);
    expect(hasSportEventStarted({ status: 'COMPLETED', startDate: beforeStart }, now)).toBe(true);
    expect(hasSportEventStarted({ status: 'CANCELLED', startDate: beforeStart }, now)).toBe(true);
  });

  it('reads an ISO start date the way the web gets it the same as a Date', () => {
    expect(hasSportEventStarted({ status: 'SCHEDULED', startDate: '2026-04-01T11:59:00.000Z' }, now)).toBe(true);
    expect(hasSportEventStarted({ status: 'SCHEDULED', startDate: '2026-04-01T12:01:00.000Z' }, now)).toBe(false);
  });
});

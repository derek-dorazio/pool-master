import { describe, expect, it } from 'vitest';
import { formatStartsIn, formatTimeUntil, getContestReadinessChecks } from './contest-readiness';
import { buildSportEvent } from './test/contest-admin-fixtures';

const NOW = new Date('2026-04-03T12:00:00.000Z');

describe('contest readiness', () => {
  it('counts down to entry close in days and hours, then hours and minutes', () => {
    expect(formatTimeUntil('2026-04-06T02:30:00.000Z', NOW)).toBe('2d 14h');
    expect(formatTimeUntil('2026-04-03T17:20:00.000Z', NOW)).toBe('5h 20m');
    expect(formatTimeUntil('2026-04-03T12:12:00.000Z', NOW)).toBe('12m');
    expect(formatTimeUntil('2026-04-03T11:00:00.000Z', NOW)).toBe('Closed');
  });

  it('says when an event starts in whole days', () => {
    expect(formatStartsIn('2026-04-09T12:00:00.000Z', NOW)).toBe('in 6 days');
    expect(formatStartsIn('2026-04-04T09:00:00.000Z', NOW)).toBe('tomorrow');
  });

  it('passes every check for a released event with golfers and tiers that has not started', () => {
    const checks = getContestReadinessChecks(buildSportEvent({ startDate: '2026-04-09T12:00:00.000Z' }), NOW);
    expect(checks.every((check) => check.isMet)).toBe(true);
    expect(checks.map((check) => check.label)).toEqual([
      'Event released',
      '89 golfers in 6 tiers',
      'Event starts in 6 days',
    ]);
  });

  it('fails the start check when the API says the event has started, and does not judge the start time itself', () => {
    const started = getContestReadinessChecks(buildSportEvent({ readinessStatus: 'EVENT_STARTED', readinessReasons: ['EVENT_STARTED'], contestEligible: false }), NOW);
    expect(started.find((check) => check.id === 'not-started')).toEqual({
      id: 'not-started',
      isMet: false,
      label: 'Event has started',
    });
    // A start time already past with no EVENT_STARTED reason is the API's call, not the page's.
    const pastStart = getContestReadinessChecks(buildSportEvent({ startDate: '2026-04-02T12:00:00.000Z' }), NOW);
    expect(pastStart.find((check) => check.id === 'not-started')?.isMet).toBe(true);
  });

  it('fails the release and field checks exactly when the API gives those reasons', () => {
    const notReady = getContestReadinessChecks(buildSportEvent({
      loadedParticipantCount: 0,
      readinessStatus: 'NOT_RELEASED',
      readinessReasons: ['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED'],
      contestEligible: false,
    }), NOW);
    expect(notReady.find((check) => check.id === 'released')).toEqual({ id: 'released', isMet: false, label: 'Event not released yet' });
    expect(notReady.find((check) => check.id === 'field')).toMatchObject({ isMet: false, label: 'No golfers loaded yet' });
    const ready = getContestReadinessChecks(buildSportEvent({ tierCount: 0 }), NOW);
    expect(ready.find((check) => check.id === 'field')).toMatchObject({ isMet: true, label: '89 golfers in 0 tiers' });
  });

  it('counts a second-chance bracket\'s event being under way as met, naming the round the bracket starts at', () => {
    const started = buildSportEvent({
      sport: 'BASKETBALL', status: 'IN_PROGRESS', readinessStatus: 'EVENT_STARTED', readinessReasons: ['EVENT_STARTED'], contestEligible: false,
    });
    expect(getContestReadinessChecks(started, NOW, 'Sweet 16').find((check) => check.id === 'not-started')).toEqual({
      id: 'not-started',
      isMet: true,
      label: 'Event under way · the bracket starts at the Sweet 16',
    });
    expect(getContestReadinessChecks(started, NOW).find((check) => check.id === 'not-started')?.isMet).toBe(false);
  });
});

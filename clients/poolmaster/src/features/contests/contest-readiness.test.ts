import { describe, expect, it } from 'vitest';
import type { SportEventDto } from '@/lib/api';
import { formatStartsIn, formatTimeUntil, getContestReadinessChecks, isKnockoutUnderWay } from './contest-readiness';
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

  it('fails the start check once the event\'s start has passed, even before its status moves', () => {
    const checks = getContestReadinessChecks(buildSportEvent({ startDate: '2026-04-02T12:00:00.000Z' }), NOW);
    expect(checks.find((check) => check.id === 'not-started')).toEqual({
      id: 'not-started',
      isMet: false,
      label: 'Event has started',
    });
  });

  it('fails the field check for an event with no golfers or no tiers', () => {
    const noGolfers = getContestReadinessChecks(buildSportEvent({ loadedParticipantCount: 0 }), NOW);
    expect(noGolfers.find((check) => check.id === 'field')).toMatchObject({ isMet: false, label: 'No golfers loaded yet' });
    const noTiers = getContestReadinessChecks(buildSportEvent({ tierCount: 0 }), NOW);
    expect(noTiers.find((check) => check.id === 'field')?.isMet).toBe(false);
  });

  it('counts a second-chance bracket\'s event being under way as met, naming the round the bracket starts at', () => {
    const started = buildSportEvent({ sport: 'BASKETBALL', status: 'IN_PROGRESS', startDate: '2026-04-02T12:00:00.000Z' });
    expect(getContestReadinessChecks(started, NOW, 'Sweet 16').find((check) => check.id === 'not-started')).toEqual({
      id: 'not-started',
      isMet: true,
      label: 'Event under way · the bracket starts at the Sweet 16',
    });
    expect(getContestReadinessChecks(started, NOW).find((check) => check.id === 'not-started')?.isMet).toBe(false);
  });
});

describe('a knockout under way', () => {
  const UNDER_WAY: Partial<SportEventDto> = { status: 'IN_PROGRESS', readinessStatus: 'EVENT_STARTED', readinessReasons: ['EVENT_STARTED'], contestEligible: false };

  it('is a knockout in progress whose only bar to a contest is that it has started', () => {
    expect(isKnockoutUnderWay(buildSportEvent({ sport: 'BASKETBALL', ...UNDER_WAY }))).toBe(true);
  });

  it('is not a contest-ready knockout, a golf event in progress, or a knockout under way that was never released or has no field', () => {
    expect(isKnockoutUnderWay(buildSportEvent({ sport: 'BASKETBALL' }))).toBe(false);
    expect(isKnockoutUnderWay(buildSportEvent({ sport: 'GOLF', ...UNDER_WAY }))).toBe(false);
    expect(isKnockoutUnderWay(buildSportEvent({ sport: 'BASKETBALL', ...UNDER_WAY, readinessReasons: ['FIELD_NOT_LOADED', 'EVENT_STARTED'] }))).toBe(false);
    expect(isKnockoutUnderWay(buildSportEvent({ sport: 'BASKETBALL', ...UNDER_WAY, status: 'COMPLETED' }))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { chooseContestHistoryYear, contestHistoryYears } from './contest-history';

describe('contestHistoryYears', () => {
  it('lists each year, US Eastern, a completed contest went final in, newest first, once each', () => {
    expect(contestHistoryYears([
      { status: 'COMPLETED', endsAt: '2025-06-01T00:00:00.000Z' },
      { status: 'COMPLETED', endsAt: '2027-01-01T04:30:00.000Z' },
      { status: 'COMPLETED', endsAt: '2026-03-01T00:00:00.000Z' },
      { status: 'COMPLETED', endsAt: '2025-09-01T00:00:00.000Z' },
    ])).toEqual([2026, 2025]);
  });

  it('leaves out contests not yet completed and a completed one with no end time', () => {
    expect(contestHistoryYears([
      { status: 'ACTIVE', endsAt: '2024-06-01T00:00:00.000Z' },
      { status: 'COMPLETED', endsAt: null },
    ])).toEqual([]);
  });
});

describe('chooseContestHistoryYear', () => {
  it('takes the year in the link when offered, else the newest, else none', () => {
    expect(chooseContestHistoryYear([2026, 2025], '2025')).toBe(2025);
    expect(chooseContestHistoryYear([2026, 2025], '2019')).toBe(2026);
    expect(chooseContestHistoryYear([2026, 2025], null)).toBe(2026);
    expect(chooseContestHistoryYear([], '2025')).toBeNull();
  });
});

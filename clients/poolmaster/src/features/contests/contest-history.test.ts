import { describe, expect, it } from 'vitest';
import { chooseContestHistoryYear } from './contest-history';

describe('chooseContestHistoryYear', () => {
  it('takes the year in the link when offered, else the newest, else none', () => {
    expect(chooseContestHistoryYear([2026, 2025], '2025')).toBe(2025);
    expect(chooseContestHistoryYear([2026, 2025], '2019')).toBe(2026);
    expect(chooseContestHistoryYear([2026, 2025], null)).toBe(2026);
    expect(chooseContestHistoryYear([], '2025')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { isHistoricalContest, shouldPollContestEntries } from './contest-status';

describe('contest status helpers', () => {
  it('pool-master-dxd.13.3 classifies completed and cancelled contests as historical', () => {
    expect(isHistoricalContest('COMPLETED')).toBe(true);
    expect(isHistoricalContest('CANCELLED')).toBe(true);
    expect(isHistoricalContest('ACTIVE')).toBe(false);
    expect(isHistoricalContest('OPEN')).toBe(false);
  });

  it('pool-master-dxd.13.3 polls contest entries only while the contest is active/live', () => {
    expect(shouldPollContestEntries('ACTIVE')).toBe(true);
    expect(shouldPollContestEntries('LOCKED')).toBe(false);
    expect(shouldPollContestEntries('COMPLETED')).toBe(false);
    expect(shouldPollContestEntries(null)).toBe(false);
  });
});

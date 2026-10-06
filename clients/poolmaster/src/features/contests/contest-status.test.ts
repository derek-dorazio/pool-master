import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  CONTEST_POLL_INTERVAL_MS,
  contestRefetchInterval,
  isHistoricalContest,
  refreshOnContestStatusChange,
  shouldPollContestEntries,
} from './contest-status';

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

  it('re-reads the contest until it settles or is cancelled, and not before the first read', () => {
    expect(contestRefetchInterval('OPEN')).toBe(CONTEST_POLL_INTERVAL_MS);
    expect(contestRefetchInterval('LOCKED')).toBe(CONTEST_POLL_INTERVAL_MS);
    expect(contestRefetchInterval('ACTIVE')).toBe(CONTEST_POLL_INTERVAL_MS);
    expect(contestRefetchInterval('COMPLETED')).toBe(false);
    expect(contestRefetchInterval('CANCELLED')).toBe(false);
    expect(contestRefetchInterval(undefined)).toBe(false);
  });

  it('refreshes the dependent query only when a read changes the cached status', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const contestKey = ['contests', 'contest-1'];
    const dependentKey = ['contests', 'contest-1', 'leaderboard'];

    // The first read has nothing to compare with.
    refreshOnContestStatusChange(queryClient, contestKey, 'ACTIVE', dependentKey);
    expect(invalidate).not.toHaveBeenCalled();

    queryClient.setQueryData(contestKey, { status: 'ACTIVE' });
    refreshOnContestStatusChange(queryClient, contestKey, 'ACTIVE', dependentKey);
    expect(invalidate).not.toHaveBeenCalled();

    refreshOnContestStatusChange(queryClient, contestKey, 'COMPLETED', dependentKey);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dependentKey });
  });
});

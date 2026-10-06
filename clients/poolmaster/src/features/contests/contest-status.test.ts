import { QueryClient } from '@tanstack/react-query';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  CONTEST_POLL_INTERVAL_MS,
  CONTEST_STATUS_LABELS,
  CONTEST_STATUS_TONES,
  contestStatusLabel,
  contestRefetchInterval,
  isHistoricalContest,
  refreshOnContestStatusChange,
  shouldPollContestEntries,
} from './contest-status';

describe('contest status helpers', () => {
  it('gives every contest status a readable label and a badge colour, so a new status without one fails', () => {
    const statuses = Object.values(ContestStatus).sort();
    expect(Object.keys(CONTEST_STATUS_LABELS).sort()).toEqual(statuses);
    expect(Object.keys(CONTEST_STATUS_TONES).sort()).toEqual(statuses);
    const unreadable = statuses.filter(
      (status) => !CONTEST_STATUS_LABELS[status] || CONTEST_STATUS_LABELS[status] === status,
    );
    expect(unreadable).toEqual([]);
  });

  it('labels open contests "Open for entries", live ones "Live" and settled ones "Final"', () => {
    expect(contestStatusLabel('OPEN')).toBe('Open for entries');
    expect(contestStatusLabel('ACTIVE')).toBe('Live');
    expect(contestStatusLabel('COMPLETED')).toBe('Final');
  });

  it('gives Live and Final their own colours, distinct from every other status', () => {
    const tones = Object.values(CONTEST_STATUS_TONES);
    expect(tones.filter((tone) => tone === CONTEST_STATUS_TONES.ACTIVE)).toHaveLength(1);
    expect(tones.filter((tone) => tone === CONTEST_STATUS_TONES.COMPLETED)).toHaveLength(1);
  });

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

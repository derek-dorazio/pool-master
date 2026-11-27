import { QueryClient } from '@tanstack/react-query';
import { ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { describe, expect, it, vi } from 'vitest';
import {
  isContestPickingOver,
  areContestEntriesOpen,
  CONTEST_POLL_INTERVAL_MS,
  CONTEST_STATUS_TONES,
  contestRefetchInterval,
  isHistoricalContest,
  refreshOnContestStatusChange,
  shouldPollContestEntries,
} from './contest-status';

describe('contest status helpers', () => {
  it('gives every contest status a readable display-string label and a badge colour, so a new status without one fails', () => {
    const statuses = Object.values(ContestStatus).sort();
    expect(Object.keys(CONTEST_STATUS_TONES).sort()).toEqual(statuses);
    const unreadable = statuses.filter(
      (status) => !enumLabel('ContestStatus', status) || enumLabel('ContestStatus', status) === status,
    );
    expect(unreadable).toEqual([]);
  });

  it('labels contests by their lifecycle stage: "Set up", "Open", "Live" and "Final"', () => {
    expect(enumLabel('ContestStatus', 'DRAFT')).toBe('Set up');
    expect(enumLabel('ContestStatus', 'OPEN')).toBe('Open');
    expect(enumLabel('ContestStatus', 'ACTIVE')).toBe('Live');
    expect(enumLabel('ContestStatus', 'COMPLETED')).toBe('Final');
  });

  it('pool-master-dxd.13.3 classifies only completed contests as historical', () => {
    expect(isHistoricalContest('COMPLETED')).toBe(true);
    expect(isHistoricalContest('ACTIVE')).toBe(false);
    expect(isHistoricalContest('OPEN')).toBe(false);
  });

  it('pool-master-dxd.13.3 polls contest entries only while the contest is active/live', () => {
    expect(shouldPollContestEntries('ACTIVE')).toBe(true);
    expect(shouldPollContestEntries('OPEN')).toBe(false);
    expect(shouldPollContestEntries('COMPLETED')).toBe(false);
    expect(shouldPollContestEntries(null)).toBe(false);
  });

  it('re-reads the contest until it settles, and not before the first read', () => {
    expect(contestRefetchInterval('OPEN')).toBe(CONTEST_POLL_INTERVAL_MS);
    expect(contestRefetchInterval('ACTIVE')).toBe(CONTEST_POLL_INTERVAL_MS);
    expect(contestRefetchInterval('COMPLETED')).toBe(false);
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

describe('areContestEntriesOpen', () => {
  const now = new Date('2026-04-01T12:00:00.000Z');
  const teeOff = '2026-04-09T12:00:00.000Z';

  it('keeps an open contest open for entries until its tee-off', () => {
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN, drawnAt: null }, teeOff, now)).toBe(true);
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN, drawnAt: null }, '2026-03-31T12:00:00.000Z', now)).toBe(false);
  });

  it('closes a random-draw contest\'s entries once its draw has run, though it is still open until tee-off', () => {
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN, drawnAt: '2026-04-01T10:00:00.000Z' }, teeOff, now)).toBe(false);
  });
});

describe('isContestPickingOver', () => {
  const started = { sportEventId: 'event-1', name: 'Event', startDate: '2026-01-10T18:00:00.000Z', endDate: null, status: 'IN_PROGRESS' as const, participantType: 'INDIVIDUAL' as const, scoringFamily: 'STROKE_PLAY' as const };

  it('calls a live lineup contest over once its events have started, and never one with no events at all', () => {
    expect(isContestPickingOver({ selectionType: SelectionType.TIERED, status: ContestStatus.ACTIVE, sportEvents: [started] })).toBe(true);
    expect(isContestPickingOver({ selectionType: SelectionType.TIERED, status: ContestStatus.ACTIVE, sportEvents: [] })).toBe(false);
  });
});

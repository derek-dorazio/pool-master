import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { type ContestEntryStatus, ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import type { ContestDto } from '@poolmaster/shared/dto';
import type { StatusBadgeProps } from '@/features/shared/ui';
import { hasContestEventStarted } from './contest-events';
import { contestSchedule } from './use-contest-schedule';

/**
 * How often a contest page re-reads what can change under it while the contest is live or
 * about to be. The backend's own live-scores sync runs every 30-60s, so polling faster would
 * only re-read the same data.
 */
export const CONTEST_POLL_INTERVAL_MS = 30_000;

/** The badge colour for each contest status; Live and Final get their own. */
export const CONTEST_STATUS_TONES: Record<ContestStatus, NonNullable<StatusBadgeProps['tone']>> = {
  DRAFT: 'neutral',
  OPEN: 'active',
  ACTIVE: 'live',
  COMPLETED: 'final',
};

export const CONTEST_ENTRY_STATUS_TONES: Record<ContestEntryStatus, NonNullable<StatusBadgeProps['tone']>> = {
  DRAFT: 'warning',
  SUBMITTED: 'success',
};

export function isHistoricalContest(status: ContestStatus) {
  return status === 'COMPLETED';
}

/**
 * Whether a member can still enter, rename or change picks: the contest is OPEN and its
 * scheduled start (the event's start, the server's entry cutoff) has not passed. The contest can
 * still read OPEN after tee-off when the event's In Progress update is late; the server refuses
 * changes then, so the page stops offering them. Without a known start, OPEN alone decides.
 * A random draw closes entries when it deals, while the contest still reads OPEN (#601).
 */
export function areContestEntriesOpen(
  contest: Pick<ContestDto, 'status' | 'drawnAt'>,
  startsAt: string | null | undefined,
  now: Date = new Date(),
) {
  if (contest.status !== ContestStatus.OPEN || contest.drawnAt) {
    return false;
  }
  return !startsAt || now.getTime() < new Date(startsAt).getTime();
}

/**
 * Whether a contest has nothing left to pick (#1762), so no entry's picks can change again: it is
 * final, or, for a contest picked once per event, live with every one of its events started.
 * Pick'em and survivor are picked week by week, or round by round inside one playoff event, so
 * they keep their pick screens until the contest is final.
 */
export function isContestPickingOver(
  contest: Pick<ContestDto, 'selectionType' | 'status' | 'sportEvents'>,
  now: Date = new Date(),
) {
  if (contest.status === ContestStatus.COMPLETED) {
    return true;
  }
  if (contest.selectionType === SelectionType.PICK_EM || contest.selectionType === SelectionType.SURVIVOR) {
    return false;
  }
  // A contest with no events has nothing started, so it is never over on that count (#1775).
  return contest.status === ContestStatus.ACTIVE
    && contest.sportEvents.length > 0
    && contest.sportEvents.every((sportEvent) => hasContestEventStarted(sportEvent, now));
}

/** Whether an entry's name can still change (#1739): until entries close, as the server allows. */
export function canRenameEntries(contest: ContestDto, now: Date = new Date()) {
  return areContestEntriesOpen(contest, contestSchedule(contest)?.startsAt, now);
}

export function shouldPollContestEntries(status: ContestStatus | null | undefined) {
  return status === 'ACTIVE';
}

/**
 * The contest read's own refetch interval (#362). A page keeps re-reading the contest until it
 * is terminal, so the polls keyed on its status start when play starts and stop at settlement
 * without a reload. Before the first read lands there is nothing to poll yet.
 */
export function contestRefetchInterval(status: ContestStatus | null | undefined) {
  if (!status || isHistoricalContest(status)) {
    return false;
  }

  return CONTEST_POLL_INTERVAL_MS;
}

/**
 * Call from a contest read with the status it just fetched (#362). When that status differs from
 * the one already cached, the queries that depend on it are read again once, straight away: the
 * leaderboard or entries poll keyed on the status would otherwise wait a further interval to
 * start at go-live, and at settlement would stop without ever reading the final standings.
 */
export function refreshOnContestStatusChange(
  queryClient: QueryClient,
  contestKey: QueryKey,
  nextStatus: ContestStatus,
  dependentKey: QueryKey,
) {
  const previousStatus = queryClient.getQueryData<{ status: ContestStatus }>(contestKey)?.status;
  if (previousStatus && previousStatus !== nextStatus) {
    void queryClient.invalidateQueries({ queryKey: dependentKey });
  }
}

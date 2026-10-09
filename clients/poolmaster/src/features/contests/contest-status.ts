import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { type ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import type { StatusBadgeProps } from '@/features/shared/ui';

/**
 * How often a contest page re-reads what can change under it while the contest is live or
 * about to be. The backend's own live-scores sync runs every 30-60s, so polling faster would
 * only re-read the same data.
 */
export const CONTEST_POLL_INTERVAL_MS = 30_000;

/**
 * What members read for each contest status. A `Record` over the enum, so adding a status without
 * a label fails the typecheck.
 */
export const CONTEST_STATUS_LABELS: Record<ContestStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open for entries',
  ACTIVE: 'Live',
  COMPLETED: 'Final',
};

/** The badge colour for each contest status; Live and Final get their own. */
export const CONTEST_STATUS_TONES: Record<ContestStatus, NonNullable<StatusBadgeProps['tone']>> = {
  DRAFT: 'neutral',
  OPEN: 'active',
  ACTIVE: 'live',
  COMPLETED: 'final',
};

/**
 * What members read for each entry status (#481). A draft counts nowhere until it is submitted,
 * so its label says so rather than echoing the enum.
 */
export const CONTEST_ENTRY_STATUS_LABELS: Record<ContestEntryStatus, string> = {
  DRAFT: 'Not submitted',
  SUBMITTED: 'Submitted',
};

export const CONTEST_ENTRY_STATUS_TONES: Record<ContestEntryStatus, NonNullable<StatusBadgeProps['tone']>> = {
  DRAFT: 'warning',
  SUBMITTED: 'success',
};

export function contestStatusLabel(status: ContestStatus) {
  return CONTEST_STATUS_LABELS[status];
}

export function isHistoricalContest(status: ContestStatus) {
  return status === 'COMPLETED';
}

/**
 * Whether a member can still enter, rename or change picks: the contest is OPEN and its
 * scheduled start (the event's start, the server's entry cutoff) has not passed. The contest can
 * still read OPEN after tee-off when the event's In Progress update is late; the server refuses
 * changes then, so the page stops offering them. Without a known start, OPEN alone decides.
 */
export function areContestEntriesOpen(
  status: ContestStatus,
  startsAt: string | null | undefined,
  now: Date = new Date(),
) {
  if (status !== ContestStatus.OPEN) {
    return false;
  }
  return !startsAt || now.getTime() < new Date(startsAt).getTime();
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

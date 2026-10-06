import type { ContestStatus } from '@poolmaster/shared/domain';

/**
 * How often a contest page re-reads what can change under it while the contest is live or
 * about to be. The backend's own live-scores sync runs every 30-60s, so polling faster would
 * only re-read the same data.
 */
export const CONTEST_POLL_INTERVAL_MS = 30_000;

export function isHistoricalContest(status: ContestStatus) {
  return status === 'COMPLETED' || status === 'CANCELLED';
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

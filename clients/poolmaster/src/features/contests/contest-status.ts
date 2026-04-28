import type { ContestStatus } from '@poolmaster/shared/domain';

export function isHistoricalContest(status: ContestStatus) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

export function shouldPollContestEntries(status: ContestStatus | null | undefined) {
  return status === 'ACTIVE';
}

import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { listedContestStartsAt } from './use-contest-schedule';

/** Where each current status stands in the list: open first, because that is where a step waits. */
const RANK_OF_STATUS: Partial<Record<ContestStatus, number>> = {
  [ContestStatus.OPEN]: 0,
  [ContestStatus.ACTIVE]: 1,
  [ContestStatus.DRAFT]: 2,
};

/** Soonest start first; a contest with no event yet comes last. */
export function bySoonestStart(left: ContestDto, right: ContestDto) {
  const leftStart = listedContestStartsAt(left);
  const rightStart = listedContestStartsAt(right);
  if (leftStart === rightStart) {
    return 0;
  }
  if (leftStart === null) {
    return 1;
  }
  if (rightStart === null) {
    return -1;
  }
  return Date.parse(leftStart) - Date.parse(rightStart);
}

/**
 * A league's current contests in the order League Home lists them (#1763): Open with the soonest
 * close first, then Live, then Set up for commissioners only, each by start. A final contest is
 * not current and is left out.
 */
export function orderCurrentContests(
  contests: readonly ContestDto[],
  { showDrafts }: { showDrafts: boolean },
): ContestDto[] {
  return contests
    .filter((contest) => {
      const rank = RANK_OF_STATUS[contest.status];
      return rank !== undefined && (contest.status !== ContestStatus.DRAFT || showDrafts);
    })
    .sort((left, right) => (RANK_OF_STATUS[left.status] ?? 0) - (RANK_OF_STATUS[right.status] ?? 0) || bySoonestStart(left, right));
}

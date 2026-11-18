import { ContestStatus, ContestStatusOrderForHomeCurrent, compareByEnumOrder } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { listedContestStartsAt } from './use-contest-schedule';

const byHomeStatus = compareByEnumOrder(ContestStatusOrderForHomeCurrent);

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
 * close first, then Live, then Set up for commissioners only (`ContestStatusOrderForHomeCurrent`),
 * each by start. A final contest is
 * not current and is left out.
 */
export function orderCurrentContests(
  contests: readonly ContestDto[],
  { showDrafts }: { showDrafts: boolean },
): ContestDto[] {
  return contests
    .filter((contest) => contest.status !== ContestStatus.COMPLETED && (contest.status !== ContestStatus.DRAFT || showDrafts))
    .sort((left, right) => byHomeStatus(left.status, right.status) || bySoonestStart(left, right));
}

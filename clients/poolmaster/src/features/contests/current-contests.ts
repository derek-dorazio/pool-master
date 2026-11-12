import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { CONTEST_STATUS_LABELS } from './contest-status';
import { listedContestStartsAt } from './use-contest-schedule';

export const CurrentContestGroup = {
  LIVE: 'live',
  OPEN: 'open',
  DRAFT: 'draft',
} as const;
export type CurrentContestGroup = (typeof CurrentContestGroup)[keyof typeof CurrentContestGroup];

/** Each group is headed by its status's label, the one contest status vocabulary. */
export const CURRENT_CONTEST_GROUP_LABEL: Record<CurrentContestGroup, string> = {
  [CurrentContestGroup.LIVE]: CONTEST_STATUS_LABELS[ContestStatus.ACTIVE],
  [CurrentContestGroup.OPEN]: CONTEST_STATUS_LABELS[ContestStatus.OPEN],
  [CurrentContestGroup.DRAFT]: CONTEST_STATUS_LABELS[ContestStatus.DRAFT],
};

export type CurrentContestSection = {
  group: CurrentContestGroup;
  contests: ContestDto[];
};

const GROUP_OF_STATUS: Partial<Record<ContestStatus, CurrentContestGroup>> = {
  [ContestStatus.ACTIVE]: CurrentContestGroup.LIVE,
  [ContestStatus.OPEN]: CurrentContestGroup.OPEN,
  [ContestStatus.DRAFT]: CurrentContestGroup.DRAFT,
};

/** Soonest start first; a contest with no event yet comes last. */
function bySoonestStart(left: ContestDto, right: ContestDto) {
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
 * A league's current contests in the order every member list shows them (#1390): Live, then
 * Open with the soonest close first, then Set up for commissioners only. Empty groups
 * are dropped; a final contest is not current and is left out.
 */
export function groupCurrentContests(
  contests: readonly ContestDto[],
  { showDrafts }: { showDrafts: boolean },
): CurrentContestSection[] {
  const byGroup = new Map<CurrentContestGroup, ContestDto[]>();
  for (const contest of contests) {
    const group = GROUP_OF_STATUS[contest.status];
    if (!group || (group === CurrentContestGroup.DRAFT && !showDrafts)) {
      continue;
    }
    byGroup.set(group, [...(byGroup.get(group) ?? []), contest]);
  }
  byGroup.get(CurrentContestGroup.OPEN)?.sort(bySoonestStart);

  return Object.values(CurrentContestGroup).flatMap((group) => {
    const grouped = byGroup.get(group);
    return grouped ? [{ group, contests: grouped }] : [];
  });
}

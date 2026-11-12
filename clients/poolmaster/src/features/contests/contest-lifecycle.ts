import { ContestStatus } from '@poolmaster/shared/domain';

/**
 * A contest's lifecycle as its commissioner follows it on Manage contest: set up, open for
 * entries, live, final. A random draw is Open while it waits for the draw and after it runs,
 * until the event starts.
 */
export const CONTEST_LIFECYCLE_STAGES = ['Set up', 'Open', 'Live', 'Final'] as const;

export type ContestLifecycleStage = (typeof CONTEST_LIFECYCLE_STAGES)[number];

/** Each status's stage. A `Record` over the enum, so a new status must say where it sits. */
const STAGE_INDEX_BY_STATUS: Record<ContestStatus, number> = {
  [ContestStatus.DRAFT]: 0,
  [ContestStatus.OPEN]: 1,
  [ContestStatus.ACTIVE]: 2,
  [ContestStatus.COMPLETED]: 3,
};

/** Where a contest is: the stage's place on the track and its name, which its badge shows too. */
export function contestLifecycleStage(status: ContestStatus): { index: number; label: ContestLifecycleStage } {
  const index = STAGE_INDEX_BY_STATUS[status];
  return { index, label: CONTEST_LIFECYCLE_STAGES[index] ?? 'Set up' };
}

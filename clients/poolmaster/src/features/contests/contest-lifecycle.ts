import { ContestStatus } from '@poolmaster/shared/domain';
import { CONTEST_STATUS_LABELS } from './contest-status';

/**
 * A contest's lifecycle as its commissioner follows it on Manage contest: set up, open for
 * entries, live, final. A random draw is Open while it waits for the draw and after it runs,
 * until the event starts. Each status's place on the track; a `Record` over the enum, so a new
 * status must say where it sits.
 */
const STAGE_INDEX_BY_STATUS: Record<ContestStatus, number> = {
  [ContestStatus.DRAFT]: 0,
  [ContestStatus.OPEN]: 1,
  [ContestStatus.ACTIVE]: 2,
  [ContestStatus.COMPLETED]: 3,
};

/** The track's stages in order, named by the status labels every contest badge shows. */
export const CONTEST_LIFECYCLE_STAGES: readonly string[] = (Object.keys(STAGE_INDEX_BY_STATUS) as ContestStatus[])
  .sort((left, right) => STAGE_INDEX_BY_STATUS[left] - STAGE_INDEX_BY_STATUS[right])
  .map((status) => CONTEST_STATUS_LABELS[status]);

/** Where a contest is on the track: the stage's place, its name read from the status labels. */
export function contestLifecycleStage(status: ContestStatus): { index: number; label: string } {
  return { index: STAGE_INDEX_BY_STATUS[status], label: CONTEST_STATUS_LABELS[status] };
}

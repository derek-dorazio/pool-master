import { ContestStatusOrder, explicitOrderValues, type ContestStatus } from '@poolmaster/shared/domain';
import { CONTEST_STATUS_LABELS } from './contest-status';

/**
 * A contest's lifecycle as its commissioner follows it on Manage contest: set up, open for
 * entries, live, final. A random draw is Open while it waits for the draw and after it runs,
 * until the event starts. The track is the contest status's own order (`ContestStatusOrder`),
 * each stage named by the status label every contest badge shows.
 */
export const CONTEST_LIFECYCLE_STAGES: readonly string[] = explicitOrderValues(ContestStatusOrder)
  .map((status) => CONTEST_STATUS_LABELS[status]);

/** Where a contest is on the track: the stage's place, its name read from the status labels. */
export function contestLifecycleStage(status: ContestStatus): { index: number; label: string } {
  return { index: ContestStatusOrder.orderIndex[status], label: CONTEST_STATUS_LABELS[status] };
}

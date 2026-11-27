/**
 * How long a recurring sync waits before its next run, read from its policy in the ingestion
 * schedule (#450, #1871). A policy that is off waits only a short recheck, so turning it back on
 * takes effect within a minute rather than after a whole interval.
 */

import type { IngestionAlwaysOnSchedulePolicy, IngestionFeedSchedulePolicy } from '@poolmaster/shared/dto/config.dto';
import type { SyncSeasonState } from '@poolmaster/shared/domain';

/** How soon a sync whose policy is off, or has no interval, looks at the schedule again. */
export const SCHEDULE_RECHECK_MS = 60 * 1000;

/**
 * A policy's interval for a league in `state` (#2009). A policy with no switch (`enabled` absent)
 * always runs on its interval (#2086).
 */
export function schedulePolicyDelayMs(policy: IngestionFeedSchedulePolicy | IngestionAlwaysOnSchedulePolicy, state: SyncSeasonState): number {
  if ('enabled' in policy && !policy.enabled) {
    return SCHEDULE_RECHECK_MS;
  }
  const interval = policy.intervals[state];
  if (interval.intervalSeconds) {
    return interval.intervalSeconds * 1000;
  }
  if (interval.intervalMinutes) {
    return interval.intervalMinutes * 60 * 1000;
  }
  return SCHEDULE_RECHECK_MS;
}

/**
 * Background job retention (#1439): a finished job is kept a while for diagnosis, then the
 * nightly cleanup deletes it. A succeeded job matters for a week; a failed one is kept a month,
 * long enough to notice and look into it.
 */

import type { BackgroundJobRepository } from '@poolmaster/shared/db';
import { BackgroundJobStatus } from '@poolmaster/shared/domain';
import { deleteInBatches, type NightlyCleanupStep } from '../../core/nightly-cleanup';

const DAY_MS = 24 * 60 * 60_000;
export const SUCCEEDED_BACKGROUND_JOBS_KEPT_DAYS = 7;
export const FAILED_BACKGROUND_JOBS_KEPT_DAYS = 30;

export class BackgroundJobRetention implements NightlyCleanupStep {
  readonly name = 'backgroundJobs';

  constructor(private readonly jobs: Pick<BackgroundJobRepository, 'deleteBatchCompletedBefore'>) {}

  async purge(now: Date): Promise<number> {
    const succeededCutoff = new Date(now.getTime() - SUCCEEDED_BACKGROUND_JOBS_KEPT_DAYS * DAY_MS);
    const failedCutoff = new Date(now.getTime() - FAILED_BACKGROUND_JOBS_KEPT_DAYS * DAY_MS);
    const succeeded = await deleteInBatches((limit) =>
      this.jobs.deleteBatchCompletedBefore(BackgroundJobStatus.SUCCEEDED, succeededCutoff, limit));
    const failed = await deleteInBatches((limit) =>
      this.jobs.deleteBatchCompletedBefore(BackgroundJobStatus.FAILED, failedCutoff, limit));
    return succeeded + failed;
  }
}

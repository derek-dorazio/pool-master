/**
 * Background job retention (#1439): a finished job is kept a while, then the nightly cleanup
 * deletes it. Activity lists every job (#1819), and an event spans about two weeks from release
 * to settlement, so every finished job, succeeded or failed, is kept 30 days (Derek, 2026-11-18).
 */

import type { BackgroundJobRepository } from '@poolmaster/shared/db';
import { BackgroundJobStatus } from '@poolmaster/shared/domain';
import { deleteInBatches, type NightlyCleanupStep } from '../../core/nightly-cleanup';

const DAY_MS = 24 * 60 * 60_000;
export const FINISHED_BACKGROUND_JOBS_KEPT_DAYS = 30;

export class BackgroundJobRetention implements NightlyCleanupStep {
  readonly name = 'backgroundJobs';

  constructor(private readonly jobs: Pick<BackgroundJobRepository, 'deleteBatchCompletedBefore'>) {}

  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - FINISHED_BACKGROUND_JOBS_KEPT_DAYS * DAY_MS);
    const succeeded = await deleteInBatches((limit) =>
      this.jobs.deleteBatchCompletedBefore(BackgroundJobStatus.SUCCEEDED, cutoff, limit));
    const failed = await deleteInBatches((limit) =>
      this.jobs.deleteBatchCompletedBefore(BackgroundJobStatus.FAILED, cutoff, limit));
    return succeeded + failed;
  }
}

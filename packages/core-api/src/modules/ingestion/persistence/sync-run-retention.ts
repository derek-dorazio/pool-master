/**
 * Sync-run retention (#1174): every sync run keeps its summary (request, outcome, stats) for a
 * year, and its detailed diagnostics (the changed rows, the job record, the raw provider payload)
 * for SYNC_RUN_DETAILS_KEPT_DAYS. The nightly cleanup runs both steps.
 */

import type { ProviderSyncRunRepository } from '@poolmaster/shared/db';
import { deleteInBatches, type NightlyCleanupStep } from '../../../core/nightly-cleanup';

const SYNC_RUN_DETAILS_KEPT_DAYS = 30;
const SYNC_RUNS_KEPT_MONTHS = 12;
const DAY_MS = 24 * 60 * 60_000;

export class SyncRunDetailsRetention implements NightlyCleanupStep {
  readonly name = 'syncRunDetails';

  constructor(private readonly syncRuns: Pick<ProviderSyncRunRepository, 'clearDetailsBatchSubmittedBefore'>) {}

  purge(now: Date): Promise<number> {
    const before = new Date(now.getTime() - SYNC_RUN_DETAILS_KEPT_DAYS * DAY_MS);
    return deleteInBatches((limit) => this.syncRuns.clearDetailsBatchSubmittedBefore(before, limit));
  }
}

export class SyncRunRetention implements NightlyCleanupStep {
  readonly name = 'syncRuns';

  constructor(private readonly syncRuns: Pick<ProviderSyncRunRepository, 'deleteBatchSubmittedBefore'>) {}

  purge(now: Date): Promise<number> {
    const before = new Date(now);
    before.setUTCMonth(before.getUTCMonth() - SYNC_RUNS_KEPT_MONTHS);
    return deleteInBatches((limit) => this.syncRuns.deleteBatchSubmittedBefore(before, limit));
  }
}

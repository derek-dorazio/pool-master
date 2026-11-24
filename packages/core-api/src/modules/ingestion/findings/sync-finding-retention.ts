/**
 * Sync-finding retention (#1999): a RESOLVED finding is deleted RESOLVED_SYNC_FINDING_RETENTION_DAYS
 * after it was resolved. An OPEN finding is never deleted, and neither is a WAIVED one: a waiver is
 * what keeps a finding the sync sees on every pass from opening again, so deleting it would bring
 * back every finding an admin accepted. The nightly cleanup runs it.
 */
import type { ProviderSyncFindingRepository } from '@poolmaster/shared/db';
import { RESOLVED_SYNC_FINDING_RETENTION_DAYS } from '@poolmaster/shared/domain';
import { deleteInBatches, type NightlyCleanupStep } from '../../../core/nightly-cleanup';

const DAY_MS = 24 * 60 * 60_000;

export class SyncFindingRetention implements NightlyCleanupStep {
  readonly name = 'syncFindings';

  constructor(private readonly findings: Pick<ProviderSyncFindingRepository, 'deleteResolvedBatchBefore'>) {}

  purge(now: Date): Promise<number> {
    const before = new Date(now.getTime() - RESOLVED_SYNC_FINDING_RETENTION_DAYS * DAY_MS);
    return deleteInBatches((limit) => this.findings.deleteResolvedBatchBefore(before, limit));
  }
}

import type { IngestionJobProviderPayload } from '../../packages/core-api/src/modules/ingestion/core/event-feed-sync';
import type { ProviderSyncRunOutcome } from '@poolmaster/shared/domain';

/** The outcome of a run that has not reported one yet, for tests that write runs by hand. */
export function syncRunOutcome(overrides: Partial<ProviderSyncRunOutcome> = {}): ProviderSyncRunOutcome {
  return { summary: 'Submitted.', stats: {}, changedCount: null, errorCount: 0, ...overrides };
}

/** A provider sync run's detailed diagnostics as the ledger writes them (#1174). */
export interface StoredSyncRunDetails {
  providerPayload?: IngestionJobProviderPayload;
  jobPayload?: unknown;
  writeDiagnostics?: unknown;
}

/** The details JSON of a stored sync run, or null when the column holds none. */
export function readStoredSyncRunDetails(detailsJson: unknown): StoredSyncRunDetails | null {
  return detailsJson && typeof detailsJson === 'object' && !Array.isArray(detailsJson)
    ? detailsJson
    : null;
}

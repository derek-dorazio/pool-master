import type {
  IngestionFeedType,
  IngestionJobProviderPayload,
} from '../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { SyncRequestContext } from '../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';

/**
 * A provider sync run's payload as the ledger writes it, for tests that read it back from the
 * database or from a repository call. Nothing validates the JSON on the way back, so this is
 * the shape a test expects to find, not a guarantee.
 */
export interface StoredSyncRunPayload {
  runType?: string;
  requestedFeed?: IngestionFeedType;
  requestPayload?: Partial<SyncRequestContext>;
  providerPayload?: IngestionJobProviderPayload;
  jobPayload?: unknown;
  writeDiagnostics?: unknown;
}

/** The payload JSON of a stored sync run, or null when the column holds no object. */
export function readStoredSyncRunPayload(payloadJson: unknown): StoredSyncRunPayload | null {
  return payloadJson && typeof payloadJson === 'object' && !Array.isArray(payloadJson)
    ? payloadJson as StoredSyncRunPayload
    : null;
}

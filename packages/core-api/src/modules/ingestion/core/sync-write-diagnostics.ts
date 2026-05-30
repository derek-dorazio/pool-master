export type SyncWriteDisposition = 'UNCHANGED' | 'CREATED' | 'UPDATED' | 'DELETED';

export interface SyncWriteDetailRow {
  id: string;
  entityType: string;
  disposition: SyncWriteDisposition;
  providerId?: string;
  externalId?: string;
  participantExternalId?: string;
  internalId?: string;
  name?: string;
  before?: unknown;
  after?: unknown;
}

export interface SyncWriteDiagnostics {
  summary: {
    total: number;
    unchanged: number;
    created: number;
    updated: number;
    deleted: number;
  };
  rows: SyncWriteDetailRow[];
}

export const emptySyncWriteDiagnostics = (): SyncWriteDiagnostics => ({
  summary: {
    total: 0,
    unchanged: 0,
    created: 0,
    updated: 0,
    deleted: 0,
  },
  rows: [],
});

export function summarizeSyncWriteRows(rows: SyncWriteDetailRow[]): SyncWriteDiagnostics {
  const summary = emptySyncWriteDiagnostics().summary;
  for (const row of rows) {
    summary.total += 1;
    switch (row.disposition) {
      case 'UNCHANGED':
        summary.unchanged += 1;
        break;
      case 'CREATED':
        summary.created += 1;
        break;
      case 'UPDATED':
        summary.updated += 1;
        break;
      case 'DELETED':
        summary.deleted += 1;
        break;
    }
  }

  return { summary, rows };
}

export function mergeSyncWriteDiagnostics(
  diagnostics: Array<SyncWriteDiagnostics | undefined>,
): SyncWriteDiagnostics {
  return summarizeSyncWriteRows(diagnostics.flatMap((diagnostic) => diagnostic?.rows ?? []));
}

export function syncWriteStats(
  diagnostics: SyncWriteDiagnostics | undefined,
): Record<string, number> {
  if (!diagnostics) {
    return {};
  }

  return {
    writeRows: diagnostics.summary.total,
    writeUnchanged: diagnostics.summary.unchanged,
    writeCreated: diagnostics.summary.created,
    writeUpdated: diagnostics.summary.updated,
    writeDeleted: diagnostics.summary.deleted,
  };
}

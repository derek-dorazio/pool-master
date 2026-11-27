import type { ProviderSyncRunDetails } from './root-admin-sync-utils';
import type { SyncRunEvidenceRow } from './sync-run-detail';

// How a sync run reads in the Sync lists and its detail dialog: its event and the rows it wrote.

export function formatEventValue(eventId: string | null | undefined) {
  if (!eventId || eventId.trim().length === 0) {
    return 'No event';
  }

  return eventId;
}

export function buildRunEvidenceRows(details: ProviderSyncRunDetails | null | undefined): SyncRunEvidenceRow[] {
  const writeRows = details?.writeDiagnostics?.rows;
  if (!writeRows) {
    return [];
  }

  return writeRows.map((row) => ({
    id: row.id,
    disposition: row.disposition,
    entityType: row.entityType,
    identifier: row.internalId ?? row.externalId ?? row.participantExternalId ?? row.id,
    name: row.name ?? 'No name',
    providerId: row.providerId ?? 'No provider',
    eventId: row.externalId ?? 'No event',
    participantId: row.participantExternalId ?? 'No participant',
    detailsPayload: {
      disposition: row.disposition,
      entityType: row.entityType,
      providerId: row.providerId ?? null,
      externalId: row.externalId ?? null,
      participantExternalId: row.participantExternalId ?? null,
      internalId: row.internalId ?? null,
      name: row.name ?? null,
      ...(row.before === undefined ? {} : { before: row.before }),
      ...(row.after === undefined ? {} : { after: row.after }),
    },
  }));
}

import { ProviderSyncRunStatus } from '@poolmaster/shared/domain';
import {
  getPayloadOutcome,
  getPayloadWarnings,
  type ProviderSyncRun,
  type ProviderSyncRunDetails,
  type ProviderSyncRunPayload,
} from './root-admin-sync-utils';
import type { SyncRunEvidenceRow } from './sync-run-detail';

// How a sync run reads in the Sync lists and its detail dialog: its status words and tone, its
// event, its sort time and the rows it wrote.

export function toSortableTimestamp(isoString: string | null | undefined) {
  if (!isoString) {
    return 0;
  }

  const parsed = Date.parse(isoString);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatEventValue(eventId: string | null | undefined) {
  if (!eventId || eventId.trim().length === 0) {
    return 'No event';
  }

  return eventId;
}

export function getStatusTone(status: string) {
  switch (status) {
    case 'COMPLETED':
    case 'HEALTHY':
      return 'success';
    case 'FAILED':
    case 'UNHEALTHY':
      return 'danger';
    case 'IN_PROGRESS':
    case 'SUBMITTED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function getRunStatusTone(run: ProviderSyncRun) {
  // A failed run stays red: its warnings never soften the badge to amber.
  const statusTone = getStatusTone(run.status);
  if (statusTone === 'danger') {
    return statusTone;
  }

  const warnings = getPayloadWarnings(run.payload);
  const severity = getPayloadSeverity(run.payload);
  if (severity === 'WARNING' || warnings.length > 0) {
    return 'warning';
  }
  if (severity === 'ERROR') {
    return 'danger';
  }

  return statusTone;
}

export function getRunStatusLabel(run: ProviderSyncRun) {
  const warnings = getPayloadWarnings(run.payload);
  if (run.status === ProviderSyncRunStatus.COMPLETED && (getPayloadSeverity(run.payload) === 'WARNING' || warnings.length > 0)) {
    return 'COMPLETED WITH WARNINGS';
  }

  return run.status;
}

function getPayloadSeverity(payload: ProviderSyncRunPayload) {
  return getPayloadOutcome(payload)?.severity ?? null;
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

/**
 * Ingestion mappers (#205) — one domain → DTO transform per object in the ingestion cluster.
 * `toProviderManualSyncSubmissionResponse` is shared by the manual event sync and the events
 * module's field refresh (plans/124 §4.4a), so there is one transform, not two.
 */
import type {
  ProviderEventCleanupGroupDto,
  ProviderEventCleanupResponse,
  ProviderEventCleanupRowDto,
  ProviderEventDto,
  ProviderManualSyncSubmissionResponse,
  ProviderSummaryDto,
  ProviderSyncRunDto,
  UnmappedProviderParticipantDto,
} from '@poolmaster/shared/dto';
import type { ProviderSyncRun } from '@poolmaster/shared/domain';
import type { SportEvent as ProviderEvent } from '../modules/ingestion/core/provider-interface';
import type {
  ProviderEventCleanupGroup,
  ProviderEventCleanupResult,
  ProviderEventCleanupRow,
  ProviderManualSyncSubmissionResult,
  ProviderSummary,
  UnmappedParticipant,
} from '../modules/ingestion/ingestion-service';

export function toProviderSummaryDto(provider: ProviderSummary): ProviderSummaryDto {
  return {
    providerId: provider.providerId,
    providerName: provider.providerName,
    status: provider.status,
    errorRate: provider.errorRate,
    latencyMs: provider.latencyMs,
    lastEventAt: provider.lastEventAt?.toISOString() ?? null,
    sportsCovered: provider.sportsCovered,
    activeEventCount: provider.activeEventCount,
  };
}

export function toProviderSyncRunDto(run: ProviderSyncRun): ProviderSyncRunDto {
  return {
    id: run.id,
    providerId: run.providerId,
    sport: run.sport,
    eventId: run.eventId,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    payload: run.payload,
  };
}

export function toProviderManualSyncSubmissionResponse(
  result: ProviderManualSyncSubmissionResult,
): ProviderManualSyncSubmissionResponse {
  return {
    sport: result.sport,
    eventId: result.eventId,
    requestedFeeds: result.requestedFeeds,
    submittedAt: result.submittedAt.toISOString(),
    syncRuns: result.syncRuns.map(toProviderSyncRunDto),
  };
}

export function toUnmappedProviderParticipantDto(participant: UnmappedParticipant): UnmappedProviderParticipantDto {
  return {
    providerId: participant.providerId,
    providerName: participant.providerName,
    externalId: participant.externalId,
    externalName: participant.externalName,
    sport: participant.sport,
  };
}

export function toProviderEventDto(event: ProviderEvent): ProviderEventDto {
  return {
    externalId: event.externalId,
    providerId: event.providerId,
    sport: event.sport,
    name: event.name,
    venue: event.venue ?? null,
    location: event.location ?? null,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    status: event.status,
    rounds: event.rounds ?? null,
    participantCount: event.participantCount ?? null,
    fieldLocked: event.fieldLocked,
    metadata: event.metadata,
  };
}

export function mapProviderEventCleanupResultToDto(
  result: ProviderEventCleanupResult,
): ProviderEventCleanupResponse {
  return {
    mode: result.mode,
    executed: result.executed,
    inventoriedAt: result.inventoriedAt.toISOString(),
    summary: { ...result.summary },
    bySport: result.bySport.map(mapCleanupGroupToDto),
    byProvider: result.byProvider.map(mapCleanupGroupToDto),
    byStatus: result.byStatus.map(mapCleanupGroupToDto),
    events: result.events.map(mapCleanupRowToDto),
  };
}

function mapCleanupGroupToDto(group: ProviderEventCleanupGroup): ProviderEventCleanupGroupDto {
  return { ...group };
}

function mapCleanupRowToDto(row: ProviderEventCleanupRow): ProviderEventCleanupRowDto {
  return {
    id: row.id,
    providerId: row.providerId,
    externalId: row.externalId,
    sport: row.sport,
    name: row.name,
    status: row.status,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    staleReason: row.staleReason,
    deletable: row.deletable,
    deleted: row.deleted,
    blockedReasons: row.blockedReasons,
    directContestCount: row.directContestCount,
    sportEventParticipantCount: row.sportEventParticipantCount,
    valuationCount: row.valuationCount,
    roundCount: row.roundCount,
    pickCount: row.pickCount,
  };
}

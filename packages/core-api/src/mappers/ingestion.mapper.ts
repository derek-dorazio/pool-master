/**
 * Ingestion mappers (#205) — one domain → DTO transform per object in the ingestion cluster.
 * `toProviderManualSyncSubmissionResponse` is shared by the manual event sync and the events
 * module's field refresh (plans/124 §4.4a), so there is one transform, not two.
 */
import type {
  ProviderEventDto,
  ProviderManualSyncSubmissionResponse,
  ProviderSummaryDto,
  ProviderSyncRunDto,
  UnmappedProviderParticipantDto,
} from '@poolmaster/shared/dto';
import { ProviderSyncRequestPayloadDtoSchema } from '@poolmaster/shared/dto';
import type { ProviderSyncRun } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type { SportEvent as ProviderEvent } from '../modules/ingestion/core/provider-interface';
import type {
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
    supportsLiveSimulation: provider.supportsLiveSimulation,
  };
}

/**
 * The stored payload is JSON from whichever release wrote the run. Its `requestPayload` is
 * typed in the contract, so it is parsed here: one written in an older shape is left out and
 * logged, rather than failing the serializer for every run in the list.
 */
export function toProviderSyncRunDto(
  run: ProviderSyncRun,
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): ProviderSyncRunDto {
  const { requestPayload: storedRequest, ...rest } = run.payload;
  const parsedRequest = storedRequest === undefined
    ? undefined
    : ProviderSyncRequestPayloadDtoSchema.safeParse(storedRequest);
  if (parsedRequest && !parsedRequest.success) {
    logger?.warn({
      action: 'ingestion.syncRun.requestPayloadSkipped',
      data: { syncRunId: run.id },
    }, 'Left a sync run\'s request payload out: it was stored in a shape the contract no longer has');
  }
  const payload = parsedRequest?.success ? { ...rest, requestPayload: parsedRequest.data } : rest;
  return {
    id: run.id,
    providerId: run.providerId,
    sport: run.sport,
    eventId: run.eventId,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    payload,
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
    syncRuns: result.syncRuns.map((run) => toProviderSyncRunDto(run)),
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
  };
}

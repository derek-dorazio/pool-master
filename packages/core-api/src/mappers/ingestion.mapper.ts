/**
 * Ingestion mappers (#205) — one domain → DTO transform per object in the ingestion cluster.
 * `toProviderManualSyncSubmissionResponse` is shared by the manual event sync and the events
 * module's field refresh (plans/124 §4.4a), so there is one transform, not two.
 */
import type {
  ProviderEventDto,
  ProviderLeagueDto,
  ProviderSettingsDto,
  ProviderManualSyncSubmissionResponse,
  ProviderListResponse,
  ProviderSummaryDto,
  ProviderSyncRunDetailDto,
  ProviderSyncRunDetailsDto,
  ProviderSyncRunDto,
} from '@poolmaster/shared/dto';
import { ProviderSyncRequestPayloadDtoSchema } from '@poolmaster/shared/dto';
import {
  PROVIDER_LEAGUE_MINUTES_RANGE,
  PROVIDER_POLL_MINUTES_RANGE,
  PROVIDER_PRIORITY_RANGE,
  PROVIDER_REQUESTS_PER_MINUTE_RANGE,
  type ProviderLeagueSettings,
  type ProviderSettings,
  type ProviderSyncRun,
  type ProviderSyncRunWithDetails,
} from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type { SportEvent as ProviderEvent } from '../modules/ingestion/core/provider-interface';
import type {
  ProviderManualSyncSubmissionResult,
  ProviderSummary,
} from '../modules/ingestion/ingestion-service';

/** The provider list, with the ranges each setting may take, from the constants the API checks against. */
export function toProviderListResponse(providers: readonly ProviderSummary[]): ProviderListResponse {
  return {
    providers: providers.map(toProviderSummaryDto),
    settingRanges: {
      requestsPerMinute: { ...PROVIDER_REQUESTS_PER_MINUTE_RANGE },
      pollMinutes: { ...PROVIDER_POLL_MINUTES_RANGE },
      priority: { ...PROVIDER_PRIORITY_RANGE },
      leagueMinutes: { ...PROVIDER_LEAGUE_MINUTES_RANGE },
    },
  };
}

export function toProviderSummaryDto(provider: ProviderSummary): ProviderSummaryDto {
  return {
    providerId: provider.providerId,
    providerName: provider.providerName,
    status: provider.status,
    errorRate: provider.errorRate,
    lastEventAt: provider.lastEventAt?.toISOString() ?? null,
    sportsCovered: provider.sportsCovered,
    primaryForSports: provider.primaryForSports,
    activeEventCount: provider.activeEventCount,
    requestsPerMinute: provider.requestsPerMinute,
    webhooksEnabled: provider.webhooksEnabled,
    syncedSportLeagueCount: provider.syncedSportLeagueCount,
    rateLimitedJobsLast24h: provider.rateLimitedJobsLast24h,
    settings: provider.settings === null ? null : toProviderSettingsDto(provider.settings, provider.settings.webhookSecretSet),
  };
}

export function toProviderSettingsDto(provider: ProviderSettings, webhookSecretSet: boolean): ProviderSettingsDto {
  return {
    id: provider.id,
    code: provider.code,
    name: provider.name,
    baseUrl: provider.baseUrl,
    requestsPerMinute: provider.requestsPerMinute,
    webhooksEnabled: provider.webhooksEnabled,
    webhookSecretSet,
    webhookPollMinutes: provider.webhookPollMinutes,
    webhookRoundPollMinutes: provider.webhookRoundPollMinutes,
    hasPlayerStats: provider.hasPlayerStats,
    isEnabled: provider.isEnabled,
    priority: provider.priority,
    leagues: provider.leagues.map(toProviderLeagueDto),
  };
}

export function toProviderLeagueDto(league: ProviderLeagueSettings): ProviderLeagueDto {
  return {
    id: league.id,
    code: league.code,
    name: league.name,
    sport: league.sport,
    webhookEventSet: league.webhookEventSet,
    quietAfterMinutes: league.quietAfterMinutes,
    typicalGameMinutes: league.typicalGameMinutes,
    isEnabled: league.isEnabled,
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
    providerName: run.providerName,
    sport: run.sport,
    eventId: run.eventId,
    kind: run.kind,
    trigger: run.trigger,
    sportLeagueId: run.sportLeagueId,
    sportEventId: run.sportEventId,
    backgroundJobId: run.backgroundJobId,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    payload,
  };
}

/** One run with its detailed diagnostics; they are stored JSON, passed through as written. */
export function toProviderSyncRunDetailDto(
  run: ProviderSyncRunWithDetails,
  logger?: Pick<FastifyBaseLogger, 'warn'>,
): ProviderSyncRunDetailDto {
  const details: ProviderSyncRunDetailsDto | null = run.details;
  return { ...toProviderSyncRunDto(run, logger), details };
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

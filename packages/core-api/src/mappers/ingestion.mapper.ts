/**
 * Ingestion mappers (#205) — one domain → DTO transform per object in the ingestion cluster.
 * `toProviderManualSyncSubmissionResponse` is shared by the manual event sync and the events
 * module's field refresh (plans/124 §4.4a), so there is one transform, not two.
 */
import type {
  ProviderLeagueDto,
  ProviderSettingsDto,
  ProviderManualSyncSubmissionResponse,
  ProviderListResponse,
  ProviderSummaryDto,
  ProviderSyncRunDetailDto,
  ProviderSyncRunDetailsDto,
  ProviderSyncRunDto,
} from '@poolmaster/shared/dto';
import {
  PROVIDER_LEAGUE_MINUTES_RANGE,
  PROVIDER_POLL_MINUTES_RANGE,
  PROVIDER_REQUESTS_PER_MINUTE_RANGE,
  type ProviderLeagueSettings,
  type ProviderSettings,
  type ProviderSyncRun,
  type ProviderSyncRunWithDetails,
} from '@poolmaster/shared/domain';
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

export function toProviderSyncRunDto(run: ProviderSyncRun): ProviderSyncRunDto {
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
    summary: run.summary,
    stats: run.stats,
    changedCount: run.changedCount,
    errorCount: run.errorCount,
  };
}

/** One run with its detailed diagnostics; they are stored JSON, passed through as written. */
export function toProviderSyncRunDetailDto(run: ProviderSyncRunWithDetails): ProviderSyncRunDetailDto {
  const details: ProviderSyncRunDetailsDto | null = run.details;
  return { ...toProviderSyncRunDto(run), details };
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


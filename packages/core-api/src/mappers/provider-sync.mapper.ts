/**
 * Provider sync mappers — shared by the generic manual-sync route
 * (`adminSyncProviderEventData`) and the golf-scoped
 * `adminRefreshGolfTournamentField` route (plans/124 §4.4a), so there is one
 * `ProviderManualSyncSubmissionResult` → DTO transform, not two
 * independently-drifting copies.
 */
import type { ProviderManualSyncSubmissionResponse, ProviderSyncRunDto } from '@poolmaster/shared/dto';
import type { ProviderManualSyncSubmissionResult, ProviderSyncRun } from '../modules/admin/provider-service';

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

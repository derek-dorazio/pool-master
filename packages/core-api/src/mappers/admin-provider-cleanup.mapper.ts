import type {
  AdminProviderEventCleanupGroupDto,
  AdminProviderEventCleanupResponse,
  AdminProviderEventCleanupRowDto,
  AdminProviderEventCleanupSummaryDto,
} from '@poolmaster/shared/dto';
import type {
  ProviderEventCleanupGroup,
  ProviderEventCleanupResult,
  ProviderEventCleanupRow,
  ProviderEventCleanupSummary,
} from '../modules/admin/provider-service';

export function mapProviderEventCleanupResultToDto(
  result: ProviderEventCleanupResult,
): AdminProviderEventCleanupResponse {
  return {
    mode: result.mode,
    executed: result.executed,
    inventoriedAt: result.inventoriedAt.toISOString(),
    summary: mapCleanupSummaryToDto(result.summary),
    bySport: result.bySport.map(mapCleanupGroupToDto),
    byProvider: result.byProvider.map(mapCleanupGroupToDto),
    byStatus: result.byStatus.map(mapCleanupGroupToDto),
    events: result.events.map(mapCleanupRowToDto),
  };
}

function mapCleanupSummaryToDto(
  summary: ProviderEventCleanupSummary,
): AdminProviderEventCleanupSummaryDto {
  return { ...summary };
}

function mapCleanupGroupToDto(
  group: ProviderEventCleanupGroup,
): AdminProviderEventCleanupGroupDto {
  return { ...group };
}

function mapCleanupRowToDto(row: ProviderEventCleanupRow): AdminProviderEventCleanupRowDto {
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
    contestSportEventCount: row.contestSportEventCount,
    sportEventParticipantCount: row.sportEventParticipantCount,
    valuationCount: row.valuationCount,
    golfRoundCount: row.golfRoundCount,
    pickCount: row.pickCount,
  };
}

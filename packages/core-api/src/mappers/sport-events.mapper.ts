/**
 * SportEvent mapper — the domain SportEvent and its loaded-participant count →
 * the canonical SportEventDto. The one place contest-setup readiness is derived
 * for the wire.
 */

import type { SportEvent } from '@poolmaster/shared/domain';
import type {
  EventReadinessReasonDto,
  EventReadinessStatusDto,
  SportEventDto,
} from '@poolmaster/shared/dto/events.dto';
import { evaluateEventOperationalState } from '../modules/events/operational-timing';

export function mapSportEventToDto(event: SportEvent, loadedParticipantCount: number): SportEventDto {
  const operationalState = evaluateEventOperationalState({
    participantCount: loadedParticipantCount,
    releaseAt: event.releaseAt,
    fieldLocksAt: event.fieldLocksAt,
    providerFieldLocked: event.fieldLocked,
  });

  return {
    id: event.id,
    externalId: event.externalId,
    providerId: event.providerId,
    sport: event.sport,
    name: event.name,
    venue: event.venue ?? null,
    location: event.location ?? null,
    status: event.status,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    rounds: event.rounds ?? null,
    participantCount: event.participantCount ?? null,
    loadedParticipantCount,
    releaseAt: event.releaseAt.toISOString(),
    fieldLocksAt: event.fieldLocksAt.toISOString(),
    fieldLocked: operationalState.fieldLocked,
    readinessStatus: operationalState.readinessStatus as EventReadinessStatusDto,
    readinessReasons: operationalState.readinessReasons as EventReadinessReasonDto[],
    contestEligible: operationalState.contestEligible,
    seasonId: event.seasonId ?? null,
    leagueEventId: event.leagueEventId ?? null,
    syncScope: event.syncScope,
    autoLifecycleEnabled: event.autoLifecycleEnabled,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

/**
 * SportEvent mapper — an event summary (the event and its counts) → the canonical
 * SportEventDto, and an event's rounds and tiers → theirs. The one place contest-setup
 * readiness and the allowed next statuses are derived for the wire.
 */

import {
  SPORT_EVENT_STATUS_TRANSITIONS,
  SportEventStatus,
  type SportEventRound,
  type SportEventTier,
} from '@poolmaster/shared/domain';
import type {
  EventReadinessReasonDto,
  ImportSportEventYearFromProviderResponse,
  EventReadinessStatusDto,
  SportEventDto,
  SportEventLiveSimulationResponse,
  SportEventRoundDto,
  SportEventTierDto,
} from '@poolmaster/shared/dto/events.dto';
import type { LiveSimulationStatus } from '../modules/ingestion/core/provider-interface';
import { evaluateEventOperationalState } from '../modules/events/operational-timing';
import type { ProviderEventYearImport, SportEventSummary } from '../modules/events/service';

/**
 * The statuses the generic transition may move an event to. DRAFT → SCHEDULED is declared,
 * but it is the release, which only the release action takes (#431), so it is not offered.
 */
function genericTransitionsFrom(status: SportEventStatus): SportEventStatus[] {
  return SPORT_EVENT_STATUS_TRANSITIONS[status].filter(
    (toStatus) => !(status === SportEventStatus.DRAFT && toStatus === SportEventStatus.SCHEDULED),
  );
}

export function mapSportEventToDto({
  event,
  loadedParticipantCount,
  untieredParticipantCount,
  tierCount,
  contestCount,
}: SportEventSummary): SportEventDto {
  const operationalState = evaluateEventOperationalState({
    status: event.status,
    startDate: event.startDate,
    participantCount: loadedParticipantCount,
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
    untieredParticipantCount,
    readinessStatus: operationalState.readinessStatus as EventReadinessStatusDto,
    readinessReasons: operationalState.readinessReasons as EventReadinessReasonDto[],
    contestEligible: operationalState.contestEligible,
    eventSeriesId: event.eventSeriesId,
    eventYear: event.eventYear,
    sportLeagueId: event.sportLeagueId,
    syncScope: event.syncScope,
    autoLifecycleEnabled: event.autoLifecycleEnabled,
    tierCount,
    contestCount,
    allowedTransitions: genericTransitionsFrom(event.status),
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export function mapSportEventRoundToDto(round: SportEventRound): SportEventRoundDto {
  return {
    id: round.id,
    sportEventId: round.sportEventId,
    roundNumber: round.roundNumber,
    scheduledDate: round.scheduledDate.toISOString(),
    scheduledEndAt: round.scheduledEndAt?.toISOString() ?? null,
  };
}

export function mapSportEventTierToDto(tier: SportEventTier): SportEventTierDto {
  return {
    id: tier.id,
    sportEventId: tier.sportEventId,
    tierKey: tier.tierKey,
    label: tier.label,
    tierNumber: tier.tierNumber,
  };
}

export function mapLiveSimulationToResponse(
  sportEventId: string,
  status: LiveSimulationStatus,
): SportEventLiveSimulationResponse {
  return {
    sportEventId,
    startsAt: status.startsAt.toISOString(),
    endsAt: status.endsAt.toISOString(),
    minutesPerRound: status.minutesPerRound,
    phase: status.phase,
    currentRound: status.currentRound,
  };
}

export function mapProviderEventYearImportToResponse(result: ProviderEventYearImport): ImportSportEventYearFromProviderResponse {
  return {
    created: result.created.map(mapSportEventToDto),
    skipped: result.skipped.map(({ externalId, name, reason }) => ({ externalId, name, reason })),
  };
}

/**
 * SportEvent mapper — an event summary (the event and its counts) → the canonical
 * SportEventDto, and an event's rounds and tiers → theirs. The one place contest-setup
 * readiness and the allowed next statuses are derived for the wire.
 */

import { SPORT_EVENT_STATUS_TRANSITIONS, type SportEventRound, type SportEventTier } from '@poolmaster/shared/domain';
import type {
  EventReadinessReasonDto,
  EventReadinessStatusDto,
  SportEventDto,
  SportEventRoundDto,
  SportEventTierDto,
} from '@poolmaster/shared/dto/events.dto';
import { evaluateEventOperationalState } from '../modules/events/operational-timing';
import type { SportEventSummary } from '../modules/events/service';

export function mapSportEventToDto({ event, loadedParticipantCount, tierCount, contestCount }: SportEventSummary): SportEventDto {
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
    eventSeriesId: event.eventSeriesId,
    eventYear: event.eventYear,
    sportLeagueId: event.sportLeagueId,
    syncScope: event.syncScope,
    autoLifecycleEnabled: event.autoLifecycleEnabled,
    tierCount,
    contestCount,
    allowedTransitions: [...SPORT_EVENT_STATUS_TRANSITIONS[event.status]],
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
    defaultPickCount: tier.defaultPickCount,
  };
}

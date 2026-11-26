/**
 * SportEvent mapper — an event summary (the event and its counts) → the canonical
 * SportEventDto, and an event's rounds and tiers → theirs. The one place contest-setup
 * readiness and the allowed next statuses are derived for the wire.
 */

import {
  isTestEvent,
  ReleaseCheckKey,
  type ReleaseCheck,
  SPORT_EVENT_STATUS_TRANSITIONS,
  SportEventStatus,
  type SportEventContest,
  type SportEventTier,
  eventProviderNameOf,
} from '@poolmaster/shared/domain';
import {
  ROUNDS_PAR_MAX,
  ROUNDS_PAR_MIN,
  type ReleaseCheckDto,
  type SportEventContestListResponse,
  type SportEventDto,
  type SportEventRoundDto,
  type SportEventTierDto,
} from '@poolmaster/shared/dto/events.dto';
import { mapRoundSlotToDto } from './sport-event-matches.mapper';
import { mapSportLeagueSeasonSlotToDto } from './sport-catalog.mapper';
import { eventContestOpenings } from '../modules/contest-management/contest-opening';
import { evaluateEventOperationalState } from '../modules/events/operational-timing';
import { areTiersAndPricesEditable } from '../modules/events/sport-event-tier-service';
import type { SportEventSummary } from '../modules/events/service';
import type { SportEventRoundView } from '../modules/events/sport-event-round-service';

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
  tierCount,
  adminCounts,
  releaseChecks,
  slots,
}: SportEventSummary): SportEventDto {
  const now = new Date();
  const operationalState = evaluateEventOperationalState({
    status: event.status,
    startDate: event.startDate,
    participantCount: loadedParticipantCount,
    now,
  });

  return {
    id: event.id,
    providerMappings: event.providerMappings.map((mapping) => ({ providerCode: mapping.providerCode, providerName: mapping.providerName, externalId: mapping.externalId })),
    providerName: eventProviderNameOf(event),
    sport: event.sport,
    sportUrlSegment: event.sportUrlSegment,
    name: event.name,
    venue: event.venue ?? null,
    location: event.location ?? null,
    status: event.status,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    rounds: event.rounds ?? null,
    roundsPar: event.roundsPar ?? null,
    roundsParMin: ROUNDS_PAR_MIN,
    roundsParMax: ROUNDS_PAR_MAX,
    participantCount: event.participantCount ?? null,
    loadedParticipantCount,
    pricing: event.pricingConfig ?? null,
    tierLayout: event.tierConfig ?? null,
    readinessStatus: operationalState.readinessStatus,
    readinessReasons: operationalState.readinessReasons,
    contestEligible: operationalState.contestEligible,
    contestOpenings: eventContestOpenings({ ...event, loadedParticipantCount }, now),
    tiersLocked: !areTiersAndPricesEditable(event),
    slotDefinitionIds: event.slotDefinitions.map((definition) => definition.id),
    sportLeagueSeasonId: event.sportLeagueSeasonId,
    championshipYear: event.championshipYear,
    sportLeagueId: event.sportLeagueId,
    participantType: event.participantType,
    scoringFamily: event.scoringFamily,
    shootout: event.slotDefinitions.some((definition) => !definition.canEndTied),
    isTestData: isTestEvent(slots),
    slots: slots.map(mapSportLeagueSeasonSlotToDto),
    autoLifecycleEnabled: event.autoLifecycleEnabled,
    tierCount,
    lastAutoReleaseCheck: event.autoReleaseCheck
      ? { checkedAt: event.autoReleaseCheck.checkedAt.toISOString(), outcome: event.autoReleaseCheck.outcome, failedChecks: [...event.autoReleaseCheck.failedChecks] }
      : null,
    adminCounts,
    releaseChecks: releaseChecks?.map(mapReleaseCheckToDto) ?? null,
    allowedTransitions: genericTransitionsFrom(event.status),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

/** A ready check for the wire: the start as an ISO string, every other value as it is. */
export function mapReleaseCheckToDto(check: ReleaseCheck): ReleaseCheckDto {
  return check.key === ReleaseCheckKey.NOT_STARTED ? { ...check, value: check.value.toISOString() } : { ...check };
}

export function mapSportEventRoundToDto(round: SportEventRoundView): SportEventRoundDto {
  return {
    id: round.id,
    sportEventId: round.sportEventId,
    roundNumber: round.roundNumber,
    slot: mapRoundSlotToDto(round.slot),
    scheduledDate: round.scheduledDate.toISOString(),
    scheduledEndAt: round.scheduledEndAt?.toISOString() ?? null,
    status: round.progress.status,
    resultCount: round.progress.resultCount,
    completedAt: round.progress.completedAt?.toISOString() ?? null,
  };
}

export function mapSportEventContestsToResponse(contests: readonly SportEventContest[]): SportEventContestListResponse {
  return {
    contests: contests.map((contest) => ({
      id: contest.id,
      name: contest.name,
      status: contest.status,
      leagueId: contest.league.id,
      leagueCode: contest.league.leagueCode,
      leagueName: contest.league.name,
      contestTemplateId: contest.contestTemplate?.id ?? null,
      contestTemplateName: contest.contestTemplate?.name ?? null,
      entryCount: contest.entryCount,
      createdAt: contest.createdAt.toISOString(),
    })),
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

/**
 * Sport catalog mapper (#236) — Sport, SportLeague and a ranking upload's preview rows to their
 * canonical DTOs.
 */

import {
  SportLeagueIssueType,
  assertNever,
  getSportDefinition,
  type SportConfig,
  type SportEventOverview,
  type SportLeagueEventOverview,
  type SportLeagueIssue,
  type SportLeagueIssueTarget,
  type SportLeagueOverview,
  type SportLeagueParticipantOverview,
  type SportLeagueSeasonDetail,
  type SportLeagueSeasonSlot,
  type SportLeaguePosition,
  type SportLeagueStructure,
  type SportLeagueSync,
  slotNeedsDates,
  testEventSlotRefusal,
} from '@poolmaster/shared/domain';
import type {
  SportDto,
  SportLeagueDto,
  SportLeagueRankingUploadPreviewRowDto,
  SportLeagueIssueDto,
  SportLeagueEventOverviewDto,
  SportEventOverviewDto,
  SportLeagueOverviewDto,
  SportLeagueParticipantOverviewDto,
  SportLeagueSeasonDto,
  SportLeagueSeasonSlotDto,
  SportLeaguePositionDto,
  SportLeagueStructureResponse,
  SportLeagueSyncDto,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import type { RankingUploadPreviewRow, SportLeagueSummary } from '../modules/sport-catalog/sport-league-service';

export function mapSportToDto(sport: SportConfig): SportDto {
  return {
    id: sport.id,
    sport: sport.sport,
    urlSegment: sport.urlSegment,
    displayOrder: sport.displayOrder,
    tournamentFormat: sport.tournamentFormat,
    createdAt: sport.createdAt.toISOString(),
    updatedAt: sport.updatedAt.toISOString(),
  };
}

export function mapSportLeagueToDto(sportLeague: SportLeagueSummary): SportLeagueDto {
  return {
    id: sportLeague.id,
    sportId: sportLeague.sportId,
    sport: sportLeague.sport,
    sportUrlSegment: sportLeague.sportUrlSegment,
    sportDisplayOrder: sportLeague.sportDisplayOrder,
    sportName: getSportDefinition(sportLeague.sport).name,
    selectionTypes: [...getSportDefinition(sportLeague.sport).selectionTypes],
    name: sportLeague.name,
    urlSegment: sportLeague.urlSegment,
    currentSeasonId: sportLeague.currentSeasonId,
    timeZone: sportLeague.timeZone,
    isActive: sportLeague.isActive,
    selectedProviderMapping: sportLeague.selectedProviderMapping === null ? null : { ...sportLeague.selectedProviderMapping },
    autoReleaseDaysBeforeStart: sportLeague.autoReleaseDaysBeforeStart,
    platformTierProfileId: sportLeague.platformTierProfileId,
    platformPricingProfileId: sportLeague.platformPricingProfileId,
    bracketAdvancement: sportLeague.bracketAdvancement,
    roundNames: [...sportLeague.roundNames],
    matchPeriodLayout: sportLeague.matchPeriodLayout,
    squaresFromRound: sportLeague.squaresFromRound,
    noun: sportLeague.noun,
    participantType: sportLeague.participantType,
    scoringFamily: sportLeague.scoringFamily,
    displayOrder: sportLeague.displayOrder,
    participantCount: sportLeague.participantCount,
    sportEventCount: sportLeague.sportEventCount,
    createdAt: sportLeague.createdAt.toISOString(),
    updatedAt: sportLeague.updatedAt.toISOString(),
  };
}

export function mapRankingUploadPreviewRowToDto(row: RankingUploadPreviewRow): SportLeagueRankingUploadPreviewRowDto {
  return { row: row.row, resolution: row.resolution, participantId: row.participantId, participantName: row.participantName };
}

/** One sport league's row on the root admin's Sports page (#1847). */
export function mapSportLeagueOverviewToDto(overview: SportLeagueOverview): SportLeagueOverviewDto {
  return {
    id: overview.id,
    sport: overview.sport,
    sportUrlSegment: overview.sportUrlSegment,
    sportDisplayOrder: overview.sportDisplayOrder,
    name: overview.name,
    providerId: overview.providerId,
    providerName: overview.providerName,
    isActive: overview.isActive,
    syncHealth: overview.syncHealth,
    issues: overview.issues.map(mapSportLeagueIssueToDto),
    season: overview.season === null ? null : { start: overview.season.start.toISOString(), end: overview.season.end.toISOString() },
    nextEventStartsAt: overview.nextEventStartsAt?.toISOString() ?? null,
    eventCount: overview.eventCount,
  };
}

export function mapSportLeagueIssueToDto(issue: SportLeagueIssue): SportLeagueIssueDto {
  const item = (entry: { label: string; occurredAt: Date; target: SportLeagueIssueTarget }) => ({
    label: entry.label,
    occurredAt: entry.occurredAt.toISOString(),
    target: { type: entry.target.type, id: entry.target.id },
  });
  switch (issue.type) {
    case SportLeagueIssueType.FINDINGS:
      return { type: issue.type, count: issue.count, items: issue.items.map((entry) => ({ severity: entry.severity, count: entry.count })) };
    case SportLeagueIssueType.SYNC:
      return { type: issue.type, count: issue.count, items: issue.items.map((entry) => ({ ...item(entry), syncKind: entry.syncKind })) };
    case SportLeagueIssueType.RELEASE:
      return { type: issue.type, count: issue.count, items: issue.items.map((entry) => ({ ...item(entry), failedChecks: entry.failedChecks })) };
    case SportLeagueIssueType.OVERDUE:
      return { type: issue.type, count: issue.count, items: issue.items.map(item) };
    default:
      return assertNever(issue);
  }
}

export function mapSportLeagueSyncToDto(sync: SportLeagueSync): SportLeagueSyncDto {
  return {
    kind: sync.kind,
    health: sync.health,
    mode: sync.mode,
    lastRun: sync.lastRun === null
      ? null
      : {
        id: sync.lastRun.id,
        status: sync.lastRun.status,
        createdAt: sync.lastRun.createdAt.toISOString(),
        startedAt: sync.lastRun.startedAt?.toISOString() ?? null,
        summary: sync.lastRun.summary,
        changedCount: sync.lastRun.changedCount,
      },
  };
}

export function mapSportEventOverviewToDto(overview: SportEventOverview): SportEventOverviewDto {
  return {
    syncHealth: overview.syncHealth,
    syncs: overview.syncs.map(mapSportLeagueSyncToDto),
    issues: overview.issues.map(mapSportLeagueIssueToDto),
    releaseMode: overview.releaseMode,
    releaseAt: overview.releaseAt?.toISOString() ?? null,
    releaseAtKind: overview.releaseAtKind,
    tierOrderBasis: overview.tierOrderBasis,
    tierOrderCoversField: overview.tierOrderCoversField,
    fieldFeed: overview.fieldFeed.map((row) => ({
      sportEventParticipantId: row.sportEventParticipantId,
      feedId: row.feedId,
      lastInFeedAt: row.lastInFeedAt?.toISOString() ?? null,
    })),
    eventPagePath: overview.eventPagePath,
  };
}

export function mapSportLeagueEventOverviewToDto(event: SportLeagueEventOverview): SportLeagueEventOverviewDto {
  return {
    id: event.id,
    name: event.name,
    sportLeagueSeasonId: event.sportLeagueSeasonId,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    status: event.status,
    releaseMode: event.releaseMode,
    releaseAt: event.releaseAt?.toISOString() ?? null,
    releaseAtKind: event.releaseAtKind,
    lastReleaseCheck: event.lastReleaseCheck === null
      ? null
      : { checkedAt: event.lastReleaseCheck.checkedAt.toISOString(), outcome: event.lastReleaseCheck.outcome, failedChecks: event.lastReleaseCheck.failedChecks },
    fieldSize: event.fieldSize,
    issues: event.issues.map(mapSportLeagueIssueToDto),
    lastSyncedAt: event.lastSyncedAt?.toISOString() ?? null,
  };
}

export function mapSportLeagueParticipantOverviewToDto(participant: SportLeagueParticipantOverview): SportLeagueParticipantOverviewDto {
  return {
    id: participant.id,
    name: participant.name,
    participantType: participant.participantType,
    shortName: participant.shortName,
    nationality: participant.nationality,
    teamAffiliation: participant.teamAffiliation,
    role: participant.role,
    ranking: participant.ranking,
    feedId: participant.feedId,
    lastInFeedAt: participant.lastInFeedAt?.toISOString() ?? null,
    addedBy: participant.addedBy,
    createdAt: participant.createdAt.toISOString(),
  };
}

export function mapSportLeaguePositionToDto(position: SportLeaguePosition): SportLeaguePositionDto {
  return {
    id: position.id,
    code: position.code,
    displayOrder: position.displayOrder,
    isFieldEligible: position.isFieldEligible,
    providerCodes: position.providerCodes.map((providerCode) => ({
      providerCode: providerCode.providerCode,
      provider: providerCode.provider,
      providerLeagueCode: providerCode.providerLeagueCode,
      providerLeagueName: providerCode.providerLeagueName,
    })),
  };
}

/** A sport league's structure (#2002): every field as it is, in the order the service gave it. */
export function mapSportLeagueStructureToDto(structure: SportLeagueStructure): SportLeagueStructureResponse {
  return {
    phases: structure.phases.map((phase) => ({
      id: phase.id,
      phase: phase.phase,
      isSynced: phase.isSynced,
      slots: phase.slots.map((slot) => ({
        id: slot.id,
        key: slot.key,
        slotKind: slot.slotKind,
        weekNumber: slot.weekNumber,
        name: slot.name,
        awardsTrophy: slot.awardsTrophy,
        squaresEligible: slot.squaresEligible,
        seriesFormat: slot.seriesFormat,
        seriesGames: slot.seriesGames,
        pairing: slot.pairing,
        matchFormat: slot.matchFormat,
        canEndTied: slot.canEndTied,
        periodUnit: slot.periodUnit,
        periodCount: slot.periodCount,
        providerMappings: slot.providerMappings.map((mapping) => ({
          id: mapping.id,
          providerId: mapping.providerId,
          providerName: mapping.providerName,
          providerLeagueCode: mapping.providerLeagueCode,
          providerLeagueName: mapping.providerLeagueName,
          matchType: mapping.matchType,
          providerValue: mapping.providerValue,
        })),
      })),
    })),
  };
}

/** One Season with its provider ids, phases and slots (#2003), in the order the domain gave them. */
export function mapSportLeagueSeasonToDto(season: SportLeagueSeasonDetail): SportLeagueSeasonDto {
  const phases = season.phases.map((phase) => {
    const slots = phase.slots.map((slot) => ({
      ...mapSportLeagueSeasonSlotToDto(slot),
      sportEventId: slot.sportEventId,
      takesTestEvent: testEventSlotRefusal(slot, season.isCurrent) === null,
      placedByWindow: slot.placedByWindow,
      // The one rule (#1924), for the Seasons the sync reads.
      needsDates: season.readBySync && slotNeedsDates(slot),
    }));
    return { id: phase.id, phase: phase.phase, isSynced: phase.isSynced, slots, slotsNeedingDates: slots.filter((slot) => slot.needsDates).length };
  });
  return {
    id: season.id,
    name: season.name,
    championshipYear: season.championshipYear,
    startsAt: season.startsAt.toISOString(),
    endsAt: season.endsAt.toISOString(),
    isCurrent: season.isCurrent,
    providerMappings: season.providerMappings.map((mapping) => ({
      id: mapping.id,
      providerId: mapping.providerId,
      providerName: mapping.providerName,
      providerLeagueCode: mapping.providerLeagueCode,
      providerSeasonId: mapping.providerSeasonId,
    })),
    phases,
    slotsNeedingDates: phases.reduce((total, phase) => total + phase.slotsNeedingDates, 0),
  };
}

/** One Season slot for the wire: the Structure tab's, an event's Slots tab's and a test slot create's. */
export function mapSportLeagueSeasonSlotToDto(slot: SportLeagueSeasonSlot): SportLeagueSeasonSlotDto {
  return {
    id: slot.id,
    slotDefinitionId: slot.slotDefinitionId,
    key: slot.key,
    slotKind: slot.slotKind,
    weekNumber: slot.weekNumber,
    name: slot.name,
    startsAt: slot.startsAt?.toISOString() ?? null,
    endsAt: slot.endsAt?.toISOString() ?? null,
    status: slot.status,
    seriesFormat: slot.seriesFormat,
    seriesGames: slot.seriesGames,
    pairing: slot.pairing,
    isTestData: slot.isTestData,
    label: slot.label,
    window: slot.window === null ? null : { startsAt: slot.window.startsAt.toISOString(), endsAt: slot.window.endsAt.toISOString(), status: slot.window.status },
  };
}

/**
 * Sport catalog mapper (#236) — Sport, SportLeague and a ranking upload's preview rows to their
 * canonical DTOs.
 */

import {
  SportLeagueIssueType,
  assertNever,
  type SportConfig,
  type SportLeagueEventOverview,
  type SportLeagueIssue,
  type SportLeagueIssueTarget,
  type SportLeagueOverview,
  type SportLeagueParticipantOverview,
  type SportLeagueSync,
} from '@poolmaster/shared/domain';
import type {
  SportDto,
  SportLeagueDto,
  SportLeagueRankingUploadPreviewRowDto,
  SportLeagueIssueDto,
  SportLeagueEventOverviewDto,
  SportLeagueOverviewDto,
  SportLeagueParticipantOverviewDto,
  SportLeagueSyncDto,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import type { RankingUploadPreviewRow, SportLeagueSummary } from '../modules/sport-catalog/sport-league-service';

export function mapSportToDto(sport: SportConfig): SportDto {
  return {
    id: sport.id,
    sport: sport.sport,
    participantType: sport.participantType,
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
    name: sportLeague.name,
    matchKeyword: sportLeague.matchKeyword,
    currentEventYear: sportLeague.currentEventYear,
    isActive: sportLeague.isActive,
    eventSyncProviderId: sportLeague.eventSyncProviderId,
    autoReleaseDaysBeforeStart: sportLeague.autoReleaseDaysBeforeStart,
    tierProfileId: sportLeague.tierProfileId,
    pricingProfileId: sportLeague.pricingProfileId,
    bracketAdvancement: sportLeague.bracketAdvancement,
    roundNames: [...sportLeague.roundNames],
    matchPeriodLayout: sportLeague.matchPeriodLayout,
    squaresFromRound: sportLeague.squaresFromRound,
    noun: sportLeague.noun,
    displayName: sportLeague.displayName,
    participantType: sportLeague.participantType,
    scoringFamily: sportLeague.scoringFamily,
    displayOrder: sportLeague.displayOrder,
    parentSportLeagueId: sportLeague.parentSportLeagueId,
    parentRoundNumbers: [...sportLeague.parentRoundNumbers],
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
    name: overview.name,
    parentSportLeagueId: overview.parentSportLeagueId,
    kind: overview.kind,
    providerId: overview.providerId,
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
    nextRunAt: sync.nextRunAt?.toISOString() ?? null,
  };
}

export function mapSportLeagueEventOverviewToDto(event: SportLeagueEventOverview): SportLeagueEventOverviewDto {
  return {
    id: event.id,
    name: event.name,
    eventYear: event.eventYear,
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

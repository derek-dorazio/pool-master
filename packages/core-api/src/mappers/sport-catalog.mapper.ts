/**
 * Sport catalog mapper (#236) — Sport, SportLeague and the affiliation edge to their
 * canonical DTOs. The affiliation embeds the canonical participant.
 */

import { SportLeagueIssueType, assertNever, type ParticipantLeagueAffiliation, type SportConfig, type SportLeagueIssue, type SportLeagueIssueTarget, type SportLeagueOverview } from '@poolmaster/shared/domain';
import type {
  ParticipantLeagueAffiliationDto,
  ParticipantLeagueAffiliationUploadPreviewRowDto,
  SportDto,
  SportLeagueDto,
  SportLeagueIssueDto,
  SportLeagueOverviewDto,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import type { AffiliationUploadPreviewRow, SportLeagueSummary } from '../modules/sport-catalog/sport-league-service';
import { mapParticipantToDto } from './participants.mapper';

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
    affiliationCount: sportLeague.affiliationCount,
    sportEventCount: sportLeague.sportEventCount,
    createdAt: sportLeague.createdAt.toISOString(),
    updatedAt: sportLeague.updatedAt.toISOString(),
  };
}

export function mapAffiliationToDto(affiliation: ParticipantLeagueAffiliation): ParticipantLeagueAffiliationDto {
  return {
    id: affiliation.id,
    sportLeagueId: affiliation.sportLeagueId,
    participantId: affiliation.participantId,
    ranking: affiliation.ranking,
    participant: mapParticipantToDto(affiliation.participant),
    createdAt: affiliation.createdAt.toISOString(),
    updatedAt: affiliation.updatedAt.toISOString(),
  };
}

export function mapAffiliationUploadPreviewRowToDto(row: AffiliationUploadPreviewRow): ParticipantLeagueAffiliationUploadPreviewRowDto {
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

function mapSportLeagueIssueToDto(issue: SportLeagueIssue): SportLeagueIssueDto {
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
    default:
      return assertNever(issue);
  }
}

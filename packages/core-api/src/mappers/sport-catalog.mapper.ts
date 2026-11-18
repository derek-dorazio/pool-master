/**
 * Sport catalog mapper (#236) — Sport, SportLeague and a ranking upload's preview rows to their
 * canonical DTOs.
 */

import type { SportConfig } from '@poolmaster/shared/domain';
import type {
  SportDto,
  SportLeagueDto,
  SportLeagueRankingUploadPreviewRowDto,
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

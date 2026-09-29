/**
 * Sport catalog mapper (#236) — Sport, SportLeague, the affiliation edge and Season to
 * their canonical DTOs. The affiliation embeds the canonical participant.
 */

import type { ParticipantLeagueAffiliation, SportConfig } from '@poolmaster/shared/domain';
import type {
  ParticipantLeagueAffiliationDto,
  ParticipantLeagueAffiliationUploadPreviewRowDto,
  SeasonDto,
  SportDto,
  SportLeagueDto,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import type { SeasonDetail } from '../modules/sport-catalog/season-service';
import type { AffiliationUploadPreviewRow, SportLeagueSummary } from '../modules/sport-catalog/sport-league-service';
import { mapParticipantToDto } from './participants.mapper';

export function mapSportToDto(sport: SportConfig): SportDto {
  return {
    id: sport.id,
    name: sport.name,
    participantType: sport.participantType,
    category: sport.category,
    tournamentFormat: sport.tournamentFormat,
    createdAt: sport.createdAt.toISOString(),
    updatedAt: sport.updatedAt.toISOString(),
  };
}

export function mapSportLeagueToDto(sportLeague: SportLeagueSummary): SportLeagueDto {
  return {
    id: sportLeague.id,
    sportId: sportLeague.sportId,
    name: sportLeague.name,
    matchKeyword: sportLeague.matchKeyword,
    currentSeasonId: sportLeague.currentSeasonId,
    isActive: sportLeague.isActive,
    affiliationCount: sportLeague.affiliationCount,
    seasonCount: sportLeague.seasonCount,
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

export function mapSeasonToDto(season: SeasonDetail): SeasonDto {
  return {
    id: season.id,
    sportLeagueId: season.sportLeagueId,
    name: season.name,
    year: season.year,
    startDate: season.startDate.toISOString(),
    endDate: season.endDate.toISOString(),
    isActive: season.isActive,
    sportEventCount: season.sportEventCount,
    isCurrent: season.isCurrent,
    createdAt: season.createdAt.toISOString(),
    updatedAt: season.updatedAt.toISOString(),
  };
}

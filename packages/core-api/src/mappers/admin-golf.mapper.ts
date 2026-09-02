/**
 * Admin Golf mappers — sport-catalog service rows to DTOs (plans/124 §3.2/§5.2).
 */
import type {
  AdminGolfFieldEntryDto,
  AdminGolfLeagueDto,
  AdminGolfLeagueRosterEntryDto,
  AdminGolfLeagueRosterUploadPreviewRowDto,
  AdminGolfLeagueSummaryDto,
  AdminGolfPlayerDetailDto,
  AdminGolfPlayerDto,
  AdminGolfRoundScoreEntryDto,
  AdminGolfRoundScorePreviewRowDto,
  AdminGolfSeasonDetailDto,
  AdminGolfSeasonDto,
  AdminGolfSeasonSummaryDto,
  AdminGolfTierGroupDto,
  AdminGolfTournamentDetailDto,
  AdminGolfTournamentDto,
  AdminGolfTournamentRoundDto,
  AdminPreviewGolfRoundScoresResponse,
  AdminUpdateGolfFieldEntriesRequest,
  AdminUpdateGolfTournamentRoundsRequest,
} from '@poolmaster/shared/dto';
import { MANUAL_ADMIN_PROVIDER_ID } from '@poolmaster/shared/domain';
import type { LeagueRosterEntry, LeagueRosterUploadPreviewRow, SportLeagueRow, SportLeagueSummary } from '../modules/sport-catalog/sport-league-service';
import type { SeasonDetail, SeasonRow, SeasonSummary } from '../modules/sport-catalog/season-service';
import type { SportEventRoundRow } from '../modules/golf/golf-round-schedule-service';
import type { GolfTournamentRow } from '../modules/golf/golf-tournament-service';
import type { GolfFieldRow } from '../modules/golf/golf-field-service';
import type { GolfTierGroup } from '../modules/golf/golf-tier-service';
import type { GolfPlayerDetail, GolfPlayerRow } from '../modules/golf/golf-player-service';
import type { GolfRoundScoreRow, GolfScorePreviewRow } from '../modules/golf/golf-score-service';

export function toAdminGolfLeagueDto(league: SportLeagueRow): AdminGolfLeagueDto {
  return {
    id: league.id,
    sportId: league.sportId,
    name: league.name,
    matchKeyword: league.matchKeyword,
    currentSeasonId: league.currentSeasonId,
    isActive: league.isActive,
    createdAt: league.createdAt.toISOString(),
    updatedAt: league.updatedAt.toISOString(),
  };
}

export function toAdminGolfLeagueSummaryDto(league: SportLeagueSummary): AdminGolfLeagueSummaryDto {
  return {
    ...toAdminGolfLeagueDto(league),
    rosterSize: league.rosterSize,
    seasonCount: league.seasonCount,
  };
}

export function toAdminGolfLeagueSummaryDtoList(leagues: SportLeagueSummary[]): AdminGolfLeagueSummaryDto[] {
  return leagues.map(toAdminGolfLeagueSummaryDto);
}

export function toAdminGolfLeagueRosterEntryDto(entry: LeagueRosterEntry): AdminGolfLeagueRosterEntryDto {
  return { ...entry };
}

export function toAdminGolfLeagueRosterEntryDtoList(entries: LeagueRosterEntry[]): AdminGolfLeagueRosterEntryDto[] {
  return entries.map(toAdminGolfLeagueRosterEntryDto);
}

export function toAdminGolfLeagueRosterUploadPreviewRowDto(
  row: LeagueRosterUploadPreviewRow,
): AdminGolfLeagueRosterUploadPreviewRowDto {
  return { ...row };
}

export function toAdminGolfLeagueRosterUploadPreviewRowDtoList(
  rows: LeagueRosterUploadPreviewRow[],
): AdminGolfLeagueRosterUploadPreviewRowDto[] {
  return rows.map(toAdminGolfLeagueRosterUploadPreviewRowDto);
}

export function toAdminGolfSeasonDto(season: SeasonRow): AdminGolfSeasonDto {
  return {
    id: season.id,
    sportLeagueId: season.sportLeagueId,
    name: season.name,
    year: season.year,
    startDate: season.startDate.toISOString(),
    endDate: season.endDate.toISOString(),
    isActive: season.isActive,
    createdAt: season.createdAt.toISOString(),
    updatedAt: season.updatedAt.toISOString(),
  };
}

export function toAdminGolfSeasonSummaryDto(season: SeasonSummary): AdminGolfSeasonSummaryDto {
  return {
    ...toAdminGolfSeasonDto(season),
    tournamentCount: season.tournamentCount,
  };
}

export function toAdminGolfSeasonSummaryDtoList(seasons: SeasonSummary[]): AdminGolfSeasonSummaryDto[] {
  return seasons.map(toAdminGolfSeasonSummaryDto);
}

export function toAdminGolfSeasonDetailDto(season: SeasonDetail): AdminGolfSeasonDetailDto {
  return {
    ...toAdminGolfSeasonSummaryDto(season),
    isCurrent: season.isCurrent,
  };
}

export function toAdminGolfTournamentRoundDto(round: SportEventRoundRow): AdminGolfTournamentRoundDto {
  return {
    roundNumber: round.roundNumber,
    scheduledDate: round.scheduledDate.toISOString(),
    scheduledEndAt: round.scheduledEndAt ? round.scheduledEndAt.toISOString() : null,
  };
}

export function toAdminGolfTournamentRoundDtoList(rounds: SportEventRoundRow[]): AdminGolfTournamentRoundDto[] {
  return rounds.map(toAdminGolfTournamentRoundDto);
}

export function toAdminGolfTournamentDto(row: GolfTournamentRow): AdminGolfTournamentDto {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    location: row.location,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    status: row.status,
    rounds: row.rounds,
    releaseAt: row.releaseAt.toISOString(),
    fieldLocksAt: row.fieldLocksAt.toISOString(),
    fieldLocked: row.fieldLocked,
    seasonId: row.seasonId,
    leagueEventId: row.leagueEventId,
    source: row.providerId === MANUAL_ADMIN_PROVIDER_ID ? 'MANUAL' : 'PROVIDER',
    syncScope: row.syncScope as AdminGolfTournamentDto['syncScope'],
    scoreSource: row.providerId === MANUAL_ADMIN_PROVIDER_ID
      ? null
      : { providerId: row.providerId, externalId: row.externalId },
    autoLifecycleEnabled: row.autoLifecycleEnabled,
    fieldCount: row.fieldCount,
    tierCount: row.tierCount,
    contestCount: row.contestCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminGolfTournamentDtoList(rows: GolfTournamentRow[]): AdminGolfTournamentDto[] {
  return rows.map(toAdminGolfTournamentDto);
}

export function toAdminGolfTournamentDetailDto(
  row: GolfTournamentRow,
  allowedTransitions: GolfTournamentRow['status'][],
): AdminGolfTournamentDetailDto {
  return {
    ...toAdminGolfTournamentDto(row),
    workflow: {
      currentStatus: row.status,
      allowedTransitions,
    },
  };
}

export function toGolfRoundScheduleUpdateInput(
  rounds: AdminUpdateGolfTournamentRoundsRequest['rounds'],
): Array<{ roundNumber: number; scheduledDate: Date; scheduledEndAt?: Date | null }> {
  return rounds.map((round) => ({
    roundNumber: round.roundNumber,
    scheduledDate: new Date(round.scheduledDate),
    scheduledEndAt: round.scheduledEndAt !== undefined
      ? (round.scheduledEndAt === null ? null : new Date(round.scheduledEndAt))
      : undefined,
  }));
}

export function toAdminGolfFieldEntryDto(row: GolfFieldRow): AdminGolfFieldEntryDto {
  return { ...row };
}

export function toAdminGolfFieldEntryDtoList(rows: GolfFieldRow[]): AdminGolfFieldEntryDto[] {
  return rows.map(toAdminGolfFieldEntryDto);
}

export function toGolfFieldEntriesUpdateInput(
  entries: AdminUpdateGolfFieldEntriesRequest['entries'],
): Array<{
  sportEventParticipantId: string;
  isActive?: boolean;
  inactiveReason?: AdminUpdateGolfFieldEntriesRequest['entries'][number]['inactiveReason'];
  worldRanking?: number | null;
  oddsToWin?: number | null;
  seedNumber?: number | null;
  price?: number | null;
}> {
  return entries.map((entry) => ({ ...entry }));
}

export function toAdminGolfTierGroupDto(tier: GolfTierGroup): AdminGolfTierGroupDto {
  return {
    tierKey: tier.tierKey,
    label: tier.label,
    tierNumber: tier.tierNumber,
    defaultPickCount: tier.defaultPickCount,
    assignments: tier.participants.map((participant) => ({
      sportEventParticipantId: participant.sportEventParticipantId,
      participantId: participant.participantId,
      tierOrderIndex: participant.tierOrderIndex,
      price: participant.price,
    })),
  };
}

export function toAdminGolfTierGroupDtoList(tiers: GolfTierGroup[]): AdminGolfTierGroupDto[] {
  return tiers.map(toAdminGolfTierGroupDto);
}

export function toAdminGolfPlayerDto(player: GolfPlayerRow): AdminGolfPlayerDto {
  return {
    id: player.id,
    name: player.name,
    firstName: player.firstName,
    lastName: player.lastName,
    shortName: player.shortName,
    nationality: player.nationality,
    position: player.position,
    teamAffiliation: player.teamAffiliation,
    externalId: player.externalId,
    status: player.status,
    providerMappingCount: player.providerMappingCount,
    createdAt: player.createdAt.toISOString(),
    updatedAt: player.updatedAt.toISOString(),
  };
}

export function toAdminGolfPlayerDtoList(players: GolfPlayerRow[]): AdminGolfPlayerDto[] {
  return players.map(toAdminGolfPlayerDto);
}

export function toAdminGolfPlayerDetailDto(player: GolfPlayerDetail): AdminGolfPlayerDetailDto {
  return {
    ...toAdminGolfPlayerDto(player),
    providerMappings: player.providerMappings,
  };
}

export function toAdminGolfRoundScoreEntryDto(row: GolfRoundScoreRow): AdminGolfRoundScoreEntryDto {
  return {
    sportEventParticipantId: row.sportEventParticipantId,
    participantId: row.participantId,
    participantName: row.participantName,
    strokes: row.strokes,
    scoreToPar: row.scoreToPar,
    thru: row.thru,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
    standing: row.standing,
  };
}

export function toAdminGolfRoundScoreEntryDtoList(rows: GolfRoundScoreRow[]): AdminGolfRoundScoreEntryDto[] {
  return rows.map(toAdminGolfRoundScoreEntryDto);
}

export function toAdminGolfRoundScorePreviewRowDto(row: GolfScorePreviewRow): AdminGolfRoundScorePreviewRowDto {
  return {
    row: row.row,
    resolution: row.resolution,
    sportEventParticipantId: row.sportEventParticipantId,
    participantName: row.participantName,
    change: row.change,
    before: row.before,
    after: row.after,
  };
}

export function toAdminPreviewGolfRoundScoresResponse(rows: GolfScorePreviewRow[]): AdminPreviewGolfRoundScoresResponse {
  return {
    rows: rows.map(toAdminGolfRoundScorePreviewRowDto),
    rollup: {
      total: rows.length,
      matched: rows.filter((row) => row.resolution === 'MATCHED').length,
      unresolved: rows.filter((row) => row.resolution === 'UNRESOLVED').length,
      ambiguous: rows.filter((row) => row.resolution === 'AMBIGUOUS').length,
    },
  };
}

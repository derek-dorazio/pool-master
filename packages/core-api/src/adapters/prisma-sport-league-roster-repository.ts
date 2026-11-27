/**
 * Prisma adapter for the roster sync's port (#2025): a league's roster rows for a Season
 * (`sport_league_season_participant_teams`), the players they name and those players' feed ids.
 */

import type { PrismaClient } from '@prisma/client';
import type { RosterIds, RosterPositionCode, RosterWrite, SportLeagueRosterRepository } from '@poolmaster/shared/db';
import { ParticipantStatus, ParticipantType, type ProviderCode } from '@poolmaster/shared/domain';
import { backgroundJobsInsert } from './prisma-background-job-repository';

export class PrismaSportLeagueRosterRepository implements SportLeagueRosterRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPositionCodes(sportLeagueProviderMappingId: string): Promise<RosterPositionCode[]> {
    const rows = await this.prisma.sportLeaguePositionProviderMapping.findMany({
      where: { sportLeagueProviderMappingId },
      select: { providerCode: true, sportLeaguePositionId: true, position: { select: { isFieldEligible: true } } },
    });
    return rows.map((row) => ({ providerCode: row.providerCode, sportLeaguePositionId: row.sportLeaguePositionId, isFieldEligible: row.position.isFieldEligible }));
  }

  async findRosterIds(input: {
    sportLeagueId: string;
    sportLeagueSeasonId: string;
    providerCode: ProviderCode;
    teamExternalIds: readonly string[];
    playerExternalIds: readonly string[];
  }): Promise<RosterIds> {
    const { id: providerId } = await this.prisma.provider.findUniqueOrThrow({ where: { code: input.providerCode }, select: { id: true } });
    const [teams, players] = await Promise.all([
      input.teamExternalIds.length === 0 ? [] : this.prisma.participantProviderMapping.findMany({
        // A team is a TEAM participant of the league, mapped as one.
        where: {
          sportLeagueId: input.sportLeagueId,
          providerId,
          participantType: ParticipantType.TEAM,
          externalId: { in: [...input.teamExternalIds] },
          participant: { participantType: ParticipantType.TEAM },
        },
        select: { externalId: true, participantId: true },
      }),
      input.playerExternalIds.length === 0 ? [] : this.prisma.participantProviderMapping.findMany({
        where: {
          sportLeagueId: input.sportLeagueId,
          providerId,
          participantType: ParticipantType.INDIVIDUAL,
          externalId: { in: [...input.playerExternalIds] },
        },
        select: { externalId: true, participantId: true, participant: { select: { name: true } } },
      }),
    ]);
    const rows = players.length === 0 ? [] : await this.prisma.sportLeagueSeasonParticipantTeam.findMany({
      where: { sportLeagueSeasonId: input.sportLeagueSeasonId, participantId: { in: players.map((player) => player.participantId) } },
      select: { participantId: true, teamParticipantId: true, sportLeaguePositionId: true },
    });
    return {
      providerId,
      teamIdByExternalId: new Map(teams.map((team) => [team.externalId, team.participantId])),
      playerByExternalId: new Map(players.map((player) => [player.externalId, { participantId: player.participantId, name: player.participant.name }])),
      rowByPlayerId: new Map(rows.map((row) => [row.participantId, { teamParticipantId: row.teamParticipantId, sportLeaguePositionId: row.sportLeaguePositionId }])),
    };
  }

  async applyRoster(write: RosterWrite): Promise<void> {
    const teamIds = [...new Set(write.rows.map((row) => row.teamParticipantId))];
    if (teamIds.length > 0) {
      const teams = await this.prisma.participant.count({
        where: { id: { in: teamIds }, sportLeagueId: write.sportLeagueId, participantType: ParticipantType.TEAM },
      });
      if (teams !== teamIds.length) throw new Error('A roster row\'s team must be a TEAM participant of the league.');
    }
    const { sportLeagueId, sportLeagueSeasonId, providerId, seenAt } = write;
    await this.prisma.$transaction([
      this.prisma.participant.createMany({
        data: write.newPlayers.map((player) => ({
          id: player.participantId,
          sportLeagueId,
          participantType: ParticipantType.INDIVIDUAL,
          name: player.name,
          status: ParticipantStatus.ACTIVE,
        })),
      }),
      this.prisma.participantProviderMapping.createMany({
        data: write.newPlayers.map((player) => ({
          participantId: player.participantId,
          sportLeagueId,
          participantType: ParticipantType.INDIVIDUAL,
          providerId,
          externalId: player.externalId,
          lastSeenAt: seenAt,
        })),
      }),
      // poolmaster-allow-query-in-loop: the players one roster renames (per-row values, one transaction)
      ...write.renamedPlayers.map((player) => this.prisma.participant.update({ where: { id: player.participantId }, data: { name: player.name } })),
      // poolmaster-allow-query-in-loop: the roster rows one sync creates or moves (per-row values, one transaction)
      ...write.rows.map((row) => this.prisma.sportLeagueSeasonParticipantTeam.upsert({
        where: { sportLeagueSeasonId_participantId: { sportLeagueSeasonId, participantId: row.participantId } },
        create: { sportLeagueId, sportLeagueSeasonId, participantId: row.participantId, teamParticipantId: row.teamParticipantId, sportLeaguePositionId: row.sportLeaguePositionId, lastSeenAt: seenAt },
        update: { teamParticipantId: row.teamParticipantId, sportLeaguePositionId: row.sportLeaguePositionId },
      })),
      this.prisma.participantProviderMapping.updateMany({
        where: { sportLeagueId, providerId, participantType: ParticipantType.INDIVIDUAL, participantId: { in: [...write.seenPlayerIds] } },
        data: { lastSeenAt: seenAt },
      }),
      this.prisma.sportLeagueSeasonParticipantTeam.updateMany({
        where: { sportLeagueSeasonId, participantId: { in: [...write.seenPlayerIds] } },
        data: { lastSeenAt: seenAt },
      }),
      backgroundJobsInsert(this.prisma, write.jobs),
    ]);
  }
}

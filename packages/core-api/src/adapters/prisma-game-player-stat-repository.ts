/**
 * Prisma adapter for the box score writer's port (#2026): a Game's player stat rows
 * (`sport_event_round_match_game_player_stats`), its Match's sides, and the players a box score's
 * feed ids name with their Season roster row's team.
 */

import type { PrismaClient } from '@prisma/client';
import type { GamePlayerStatRepository, GamePlayerStatRow, StatGame, StatPlayer } from '@poolmaster/shared/db';
import { ParticipantType, type ProviderCode } from '@poolmaster/shared/domain';

// poolmaster-allow-test-export: wired with GameBoxScoreSync by the box score fetch job, #2026 part B
export class PrismaGamePlayerStatRepository implements GamePlayerStatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findStatGames(input: { sportLeagueId: string; providerCode: ProviderCode; sportEventRoundMatchGameIds: readonly string[] }): Promise<StatGame[]> {
    if (input.sportEventRoundMatchGameIds.length === 0) return [];
    const games = await this.prisma.sportEventRoundMatchGame.findMany({
      where: { id: { in: [...input.sportEventRoundMatchGameIds] }, match: { sportEvent: { sportLeagueId: input.sportLeagueId } } },
      select: {
        id: true,
        sportEventId: true,
        sportEventRoundMatchId: true,
        providerMappings: { where: { provider: { code: input.providerCode } }, select: { externalId: true } },
        match: {
          select: {
            sportEvent: { select: { sportLeagueId: true, sportLeagueSeasonId: true } },
            sides: { select: { id: true, sportEventParticipant: { select: { participantId: true } } } },
          },
        },
      },
    });
    return games.map((game) => ({
      sportEventRoundMatchGameId: game.id,
      sportEventRoundMatchId: game.sportEventRoundMatchId,
      sportEventId: game.sportEventId,
      sportLeagueId: game.match.sportEvent.sportLeagueId,
      sportLeagueSeasonId: game.match.sportEvent.sportLeagueSeasonId,
      providerGameId: game.providerMappings[0]?.externalId ?? null,
      sides: game.match.sides.map((side) => ({ sportEventRoundMatchSideId: side.id, participantId: side.sportEventParticipant?.participantId ?? null })),
    }));
  }

  async findStatPlayers(input: { sportLeagueId: string; sportLeagueSeasonId: string; providerCode: ProviderCode; playerExternalIds: readonly string[] }): Promise<Map<string, StatPlayer>> {
    if (input.playerExternalIds.length === 0) return new Map();
    const mappings = await this.prisma.participantProviderMapping.findMany({
      where: {
        sportLeagueId: input.sportLeagueId,
        provider: { code: input.providerCode },
        participantType: ParticipantType.INDIVIDUAL,
        externalId: { in: [...new Set(input.playerExternalIds)] },
      },
      select: { externalId: true, participantId: true },
    });
    const rows = mappings.length === 0 ? [] : await this.prisma.sportLeagueSeasonParticipantTeam.findMany({
      where: { sportLeagueSeasonId: input.sportLeagueSeasonId, participantId: { in: mappings.map((mapping) => mapping.participantId) } },
      select: { participantId: true, teamParticipantId: true },
    });
    const teamByPlayer = new Map(rows.map((row) => [row.participantId, row.teamParticipantId]));
    return new Map(mappings.map((mapping) => [mapping.externalId, { participantId: mapping.participantId, teamParticipantId: teamByPlayer.get(mapping.participantId) ?? null }]));
  }

  async findGameStats(sportEventRoundMatchGameIds: readonly string[]): Promise<GamePlayerStatRow[]> {
    if (sportEventRoundMatchGameIds.length === 0) return [];
    return this.prisma.sportEventRoundMatchGamePlayerStat.findMany({
      where: { sportEventRoundMatchGameId: { in: [...sportEventRoundMatchGameIds] } },
      select: { sportEventRoundMatchId: true, sportEventRoundMatchGameId: true, sportEventRoundMatchSideId: true, participantId: true, stat: true, value: true },
    });
  }

  async replaceGameStats(input: { sportLeagueId: string; sportEventRoundMatchGameIds: readonly string[]; rows: readonly GamePlayerStatRow[] }): Promise<void> {
    if (input.sportEventRoundMatchGameIds.length === 0) return;
    const gameIds = [...input.sportEventRoundMatchGameIds];
    const named = new Set(gameIds);
    const stray = input.rows.find((row) => !named.has(row.sportEventRoundMatchGameId));
    if (stray !== undefined) throw new Error(`A stat row of Game ${stray.sportEventRoundMatchGameId} was given, which is not one of the Games named.`);
    const data = input.rows.map((row) => ({ sportLeagueId: input.sportLeagueId, ...row }));
    await this.prisma.$transaction([
      this.prisma.sportEventRoundMatchGamePlayerStat.deleteMany({ where: { sportEventRoundMatchGameId: { in: gameIds } } }),
      this.prisma.sportEventRoundMatchGamePlayerStat.createMany({ data }),
    ]);
  }
}

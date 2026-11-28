/**
 * A Game's box score (#2026) against real Postgres: the stat rows the box score sync writes through
 * the Prisma repository, the database's own check that a row's side is one of its Game's Match's,
 * and the sync's statement count. Only the provider is stood in for. No mocks of the database.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ParticipantType, ProviderCode, ProviderSyncFindingKind, Sport, SportStat } from '@poolmaster/shared/domain';
import { PrismaGamePlayerStatRepository } from '../../../packages/core-api/src/adapters/prisma-game-player-stat-repository';
import { PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters/prisma-sport-catalog-repositories';
import type { ProviderPlayerGameStats } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { GameBoxScoreSync } from '../../../packages/core-api/src/modules/ingestion/stats/game-box-score-sync';
import { expectSameStatementCount } from '../query-scaling';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { freshEventEdition } from '../../support/event-edition';
import { syncLeagueTo } from '../../support/league-sync';
import { createMatchRow } from '../../support/match-rows';
import { insertTestSportLeague } from '../../support/test-sport-league';
import { oneEventSlotId } from '../../support/test-slots';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const YEAR = 2026;

/**
 * A synced football league of the test's own with one week: the Chiefs at the Bills in Game 7001
 * and the Ravens at the Steelers in Game 7002, each Game mapped to its feed id, and `players`
 * Chiefs players rostered in the week's Season, each mapped from feed id 100, 101, …. A second
 * week in one test names other feed ids for its Games, since a feed id names one Game.
 */
async function footballWeek(players: number, gameIds: readonly [string, string] = ['7001', '7002']) {
  const prisma = getPrisma();
  const league = await insertTestSportLeague(prisma, { sport: Sport.FOOTBALL, name: `Box Scores ${randomUUID().slice(0, 8)}`, championshipYear: YEAR });
  await syncLeagueTo(prisma, league.id, 'nfl');
  const provider = await prisma.provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE }, select: { id: true } });
  const edition = await freshEventEdition(prisma, { sport: Sport.FOOTBALL, sportLeagueId: league.id, championshipYear: YEAR });
  const event = await prisma.sportEvent.create({ data: { ...edition, name: `Week 12 ${randomUUID().slice(0, 8)}`, startDate: new Date('2026-11-22T18:00:00Z'), status: 'SCHEDULED' } });
  const round = await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 1, scheduledDate: event.startDate } });
  const teams = await prisma.participant.createManyAndReturn({
    data: ['Chiefs', 'Bills', 'Ravens', 'Steelers'].map((name) => ({ sportLeagueId: league.id, name, participantType: ParticipantType.TEAM })),
  });
  const [chiefs, bills, ravens, steelers] = teams;
  const field = await prisma.sportEventParticipant.createManyAndReturn({ data: teams.map((team) => ({ sportEventId: event.id, participantId: team.id })) });
  const fieldRow = (teamId: string) => field.find((row) => row.participantId === teamId)?.id ?? null;
  const games = [];
  for (const [matchNumber, away, home, externalId] of [[1, chiefs, bills, gameIds[0]], [2, ravens, steelers, gameIds[1]]] as const) {
    // poolmaster-allow-query-in-loop: two fixture matches
    const match = await createMatchRow(prisma, {
      sportEventId: event.id, sportEventRoundId: round.id, sportEventSlotId: round.sportEventSlotId, matchNumber,
      teams: [fieldRow(away.id), fieldRow(home.id)], isNeutralSite: false, providerMapping: { providerId: provider.id, externalId },
    });
    // poolmaster-allow-query-in-loop: two fixture matches
    games.push(await prisma.sportEventRoundMatchGame.findFirstOrThrow({ where: { sportEventRoundMatchId: match.id }, select: { id: true, sportEventRoundMatchId: true } }));
  }
  const position = await prisma.sportLeaguePosition.create({ data: { sportLeagueId: league.id, code: 'QB', displayOrder: 1, isFieldEligible: true } });
  const roster = await prisma.participant.createManyAndReturn({
    data: Array.from({ length: players }, (_, index) => ({ sportLeagueId: league.id, name: `Chief ${String(index)}`, participantType: ParticipantType.INDIVIDUAL })),
  });
  await prisma.participantProviderMapping.createMany({
    data: roster.map((player, index) => ({ participantId: player.id, sportLeagueId: league.id, participantType: ParticipantType.INDIVIDUAL, providerId: provider.id, externalId: String(100 + index) })),
  });
  await prisma.sportLeagueSeasonParticipantTeam.createMany({
    data: roster.map((player) => ({ sportLeagueId: league.id, sportLeagueSeasonId: edition.sportLeagueSeasonId, participantId: player.id, teamParticipantId: chiefs.id, sportLeaguePositionId: position.id, lastSeenAt: new Date() })),
  });
  return { league, games, chiefs, bills, roster };
}

function boxScoreSync(lines: () => ProviderPlayerGameStats[]) {
  const prisma = getPrisma();
  const findings = {
    raiseOfSource: jest.fn(async (..._input: unknown[]) => undefined),
    raiseUnmappedParticipants: jest.fn(async (..._input: unknown[]) => undefined),
    resolveOfSource: jest.fn(async (..._input: unknown[]) => 0),
  };
  const sync = new GameBoxScoreSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    providers: { all: () => [balldontlieTestProvider({ hasPlayerStats: true })] },
    boxScoreSource: { listBoxScores: async () => lines() },
    stats: new PrismaGamePlayerStatRepository(prisma),
    findings,
  });
  return { sync, findings };
}

const statRows = (sportLeagueId: string) => getPrisma().sportEventRoundMatchGamePlayerStat.findMany({
  where: { sportLeagueId },
  select: { player: { select: { name: true } }, side: { select: { sideNumber: true } }, stat: true, value: true },
  orderBy: [{ player: { name: 'asc' } }, { stat: 'asc' }],
});

describe('a Game\'s box score', () => {
  it('writes each rostered player\'s stats on their team\'s side of the Game, and refuses a player whose team is not in it', async () => {
    const { league, games } = await footballWeek(2);
    const { sync, findings } = boxScoreSync(() => [
      { providerGameId: '7001', playerExternalId: '100', playerName: 'Chief 0', stats: [{ stat: SportStat.PASSING_YARDS, value: 291 }, { stat: SportStat.PASSING_TOUCHDOWNS, value: 3 }] },
      { providerGameId: '7002', playerExternalId: '101', playerName: 'Chief 1', stats: [{ stat: SportStat.RECEPTIONS, value: 4 }] },
    ]);

    const result = await sync.syncGames(league.id, games.map((game) => game.id));

    expect(result).toMatchObject({ planHasStats: true, gamesRead: 2, gamesChanged: 1, rowsWritten: 2, playersNotInGame: 1 });
    expect(await statRows(league.id)).toEqual([
      { player: { name: 'Chief 0' }, side: { sideNumber: 1 }, stat: SportStat.PASSING_TOUCHDOWNS, value: 3 },
      { player: { name: 'Chief 0' }, side: { sideNumber: 1 }, stat: SportStat.PASSING_YARDS, value: 291 },
    ]);
    expect(findings.raiseOfSource).toHaveBeenCalledWith(expect.any(String), [expect.objectContaining({ kind: ProviderSyncFindingKind.BOX_SCORE_PLAYER_NOT_IN_GAME, providerValue: '101' })]);
  });

  it('rewrites a corrected stat and keeps one row per Game, player and stat', async () => {
    const { league, games } = await footballWeek(1);
    let yards = 291;
    const { sync } = boxScoreSync(() => [{ providerGameId: '7001', playerExternalId: '100', playerName: 'Chief 0', stats: [{ stat: SportStat.PASSING_YARDS, value: yards }] }]);
    await sync.syncGames(league.id, games.map((game) => game.id));

    yards = 301;
    await sync.syncGames(league.id, games.map((game) => game.id));

    expect(await statRows(league.id)).toEqual([{ player: { name: 'Chief 0' }, side: { sideNumber: 1 }, stat: SportStat.PASSING_YARDS, value: 301 }]);
  });

  it('is refused by the database when the row\'s side belongs to another Game\'s Match', async () => {
    const { league, games, roster } = await footballWeek(1);
    const prisma = getPrisma();
    const otherSide = await prisma.sportEventRoundMatchSide.findFirstOrThrow({ where: { sportEventRoundMatchId: games[1].sportEventRoundMatchId }, select: { id: true } });

    await expect(prisma.sportEventRoundMatchGamePlayerStat.create({
      data: {
        sportLeagueId: league.id,
        sportEventRoundMatchId: games[0].sportEventRoundMatchId,
        sportEventRoundMatchGameId: games[0].id,
        sportEventRoundMatchSideId: otherSide.id,
        participantId: roster[0].id,
        stat: SportStat.PASSING_YARDS,
        value: 1,
      },
    })).rejects.toThrow(/sport_event_round_match_game_player_stats_side_fkey/);
  });

  it('writes a week\'s box scores in the same statements for 2 players as for 20', async () => {
    await expectSameStatementCount({
      seed: async (players) => {
        const gameIds = [String(8000 + players), String(9000 + players)] as const;
        const week = await footballWeek(players, gameIds);
        const lines = week.roster.map((_, index): ProviderPlayerGameStats => (
          { providerGameId: gameIds[0], playerExternalId: String(100 + index), playerName: null, stats: [{ stat: SportStat.RUSHING_YARDS, value: index }, { stat: SportStat.RECEPTIONS, value: 1 }] }
        ));
        return { ...week, sync: boxScoreSync(() => lines).sync };
      },
      call: async ({ league, games, sync }) => {
        await sync.syncGames(league.id, games.map((game) => game.id));
        return statRows(league.id);
      },
      rowsShown: (rows) => rows.length / 2,
    });
  });
});

import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ScoringFamily, Sport, SportStat, TournamentFormat } from '@poolmaster/shared/domain';
import {
  ContestLeaderboardResponseSchema,
  SportEventParticipantListResponseSchema,
  SportEventResponseSchema,
  SportLeagueListResponseSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema, type ErrorEnvelope } from '@poolmaster/shared/dto/errors.dto';
import {
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventParticipantStatLineRepository,
  PrismaSportEventParticipantValuationRepository,
  PrismaSportEventRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
} from '../../../packages/core-api/src/adapters';
import { createContestSportEventReader } from '../../../packages/core-api/src/modules/contest-management/wiring';
import { createContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

// The composite family (#934) against real Postgres: a World Series stat pool scored from its
// players' stat lines (Box Score: total bases + runs + RBI + walks + stolen bases each game),
// rescored when a line is corrected, and settled from the corrected lines. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PLAYERS = ['Ace', 'Blaze', 'Cruz', 'Dash'];

/**
 * A World Series of two games played so far, with four players, on a stat pool sport league of
 * its own: baseball's, of players scored by the composite family.
 */
async function seedSeries(status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS') {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  // cleanupTestData clears the sports table, the migration's reference row with it.
  const baseball = await prisma.sport.upsert({
    where: { sport: Sport.BASEBALL },
    create: { sport: Sport.BASEBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const worldSeries = await prisma.sportLeague.create({
    data: { sportId: baseball.id, name: `World Series ${suffix}`, participantType: 'INDIVIDUAL', scoringFamily: 'COMPOSITE' },
  });
  const series = await prisma.eventSeries.create({ data: { sportLeagueId: worldSeries.id, name: `World Series ${suffix}` } });
  const event = await prisma.sportEvent.create({
    data: {
      eventSeriesId: series.id,
      eventYear: 2025,
      externalId: `world-series-${suffix}`,
      providerId: 'manual-admin',
      sport: Sport.BASEBALL,
      name: `World Series ${suffix}`,
      startDate: new Date('2025-10-24T23:00:00.000Z'),
      endDate: new Date('2025-11-01T23:00:00.000Z'),
      status,
      rounds: 7,
    },
  });
  const games = await Promise.all([1, 2].map((roundNumber) => prisma.sportEventRound.create({
    data: { sportEventId: event.id, roundNumber, scheduledDate: new Date(`2025-10-2${4 + roundNumber}T23:00:00.000Z`) },
  })));
  const field = [];
  for (const name of PLAYERS) {
    const participant = await prisma.participant.create({
      data: { sportId: baseball.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL' },
    });
    field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } }));
  }
  const [ace, blaze, cruz, dash] = field;
  /** Writes one player's line for one game. */
  const line = async (player: { id: string }, game: number, stats: Partial<Record<SportStat, number>>) => {
    const round = await prisma.sportEventParticipantRound.create({
      data: { sportEventParticipantId: player.id, sportEventRoundId: games[game - 1].id, status: 'COMPLETED' },
    });
    await prisma.sportEventParticipantStatLine.createMany({
      data: Object.entries(stats).map(([stat, value]) => ({ participantRoundId: round.id, stat: stat as SportStat, value })),
    });
    return round;
  };
  return { prisma, suffix, event, ace, blaze, cruz, dash, line };
}

describe('SportEventParticipantStatLineRepository', () => {
  it('reads back only the event\'s own stat lines, each with its round and stat', async () => {
    const { prisma, event, ace, line } = await seedSeries();
    const other = await seedSeries();
    const round = await line(ace, 1, { TOTAL_BASES: 4, RUNS: 1 });
    await other.line(other.ace, 1, { WALKS: 2 });

    const lines = await new PrismaSportEventParticipantStatLineRepository(prisma).findBySportEvent(event.id);

    expect(lines.map((statLine) => [statLine.participantRoundId, statLine.stat, statLine.value])).toEqual([
      [round.id, SportStat.TOTAL_BASES, 4],
      [round.id, SportStat.RUNS, 1],
    ]);
  });

  it('refuses a second line for the same stat of the same game at the database', async () => {
    const { prisma, ace, line } = await seedSeries();
    const round = await line(ace, 1, { RUNS: 1 });

    await expect(prisma.sportEventParticipantStatLine.create({ data: { participantRoundId: round.id, stat: SportStat.RUNS, value: 2 } }))
      .rejects.toThrow();
  });
});

describe('A stat pool sport league', () => {
  it('reads back as a league of players scored by the composite family, where its sport\'s own leagues keep its teams and bracket', async () => {
    const { prisma, event } = await seedSeries();
    const repository = new PrismaSportLeagueRepository(prisma);
    const baseball = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.BASEBALL } });
    const mlb = await prisma.sportLeague.create({ data: { sportId: baseball.id, name: `MLB ${randomUUID().slice(0, 8)}` } });

    const worldSeries = await repository.findById((await prisma.eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId } })).sportLeagueId);

    expect([worldSeries?.participantType, worldSeries?.scoringFamily]).toEqual(['INDIVIDUAL', ScoringFamily.COMPOSITE]);
    expect(await repository.findById(mlb.id)).toMatchObject({ participantType: null, scoringFamily: null });
  });

  it('puts its overrides on every event read, so the event resolves to the composite family', async () => {
    const { prisma, event } = await seedSeries();

    const read = await new PrismaSportEventRepository(prisma).findById(event.id);

    expect([read?.participantType, read?.scoringFamily]).toEqual(['INDIVIDUAL', ScoringFamily.COMPOSITE]);
  });

  it('gives contest setup golf\'s tournament format for its event, not its team sport\'s matches', async () => {
    const { prisma, event } = await seedSeries();
    const reader = createContestSportEventReader({
      sportEvents: new PrismaSportEventRepository(prisma),
      sports: new PrismaSportRepository(prisma),
      field: new PrismaSportEventParticipantRepository(prisma),
      valuations: new PrismaSportEventParticipantValuationRepository(prisma),
      matches: new PrismaSportEventMatchRepository(prisma),
    });

    expect(await reader.findById(event.id)).toMatchObject({
      sport: Sport.BASEBALL,
      tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
      participantType: 'INDIVIDUAL',
      scoringFamily: ScoringFamily.COMPOSITE,
    });
  });
});

describe('World Series stat pool contest — scored from its players\' stat lines', () => {
  async function seedContest(status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS') {
    const seeded = await seedSeries(status);
    const { prisma, suffix, event, ace, blaze, cruz, dash } = seeded;
    const owner = await createTestUser({ displayName: `Series Owner ${suffix}` });
    const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `WSP${suffix.toUpperCase()}`, name: `Dugout League ${suffix}` } });
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
    });
    const [squadOne, squadTwo] = await Promise.all([1, 2].map((number) => prisma.squad.create({
      data: { leagueId: league.id, createdBy: owner.user.id, name: `Bench ${number} ${suffix}` },
    })));
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id, seasonYear: 2025, sportEvents: { create: { sportEventId: event.id, sequence: 1 } }, name: `Box Score pool ${suffix}`,
        status: 'ACTIVE', contestFormat: 'ROSTER', selectionType: 'BUDGET_PICK',
      },
    });
    await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'BUDGET_PICK',
        configJson: { selectionType: 'BUDGET_PICK', rosterSize: 2, countedScores: 2, salaryCap: 100 },
        participantScoringRules: { create: { participantScoringDefinitionId: 'COMPOSITE_TOTAL', sortOrder: 1, config: {} } },
      },
    });
    const [sluggers, speedsters] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squadOne.id, entryNumber: 1, name: 'Ace and Blaze', events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } } } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squadTwo.id, entryNumber: 1, name: 'Cruz and Dash', events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } } } }),
    ]);
    await prisma.contestEntryPick.createMany({
      data: [
        { entryId: sluggers.id, sportEventParticipantId: ace.id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: sluggers.id, sportEventParticipantId: blaze.id, contestFormat: 'ROSTER', slot: 2 },
        { entryId: speedsters.id, sportEventParticipantId: cruz.id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: speedsters.id, sportEventParticipantId: dash.id, contestFormat: 'ROSTER', slot: 2 },
      ],
    });
    return { ...seeded, owner, contest, sluggers, speedsters };
  }

  async function board(contestId: string, headers: Record<string, string>) {
    const response = await getApp().inject({ method: 'GET', url: `/api/v1/contests/${contestId}/leaderboard`, headers });
    expect(response.statusCode).toBe(200);
    return ContestLeaderboardResponseSchema.parse(response.json());
  }

  it('shows no totals before any game\'s stats are in', async () => {
    const { owner, contest } = await seedContest();

    const leaderboard = await board(contest.id, owner.headers);

    expect(leaderboard.scoringDefinitionId).toBe('COMPOSITE_TOTAL');
    expect(leaderboard.entries.map((entry) => entry.totalScore)).toEqual([null, null]);
  });

  it('ranks entries by their players\' Box Scores over the games played, higher first, a player with no line scoring 0', async () => {
    const { owner, contest, ace, blaze, cruz, line, sluggers, speedsters } = await seedContest();
    // Ace: game 1 is 4 TB + 1 R + 2 RBI = 7, game 2 is 1 BB + 1 SB = 2. Blaze has no line yet: 0.
    await line(ace, 1, { TOTAL_BASES: 4, RUNS: 1, RUNS_BATTED_IN: 2 });
    await line(ace, 2, { WALKS: 1, STOLEN_BASES: 1 });
    await line(blaze, 1, {});
    // Cruz: game 1 is 2 TB + 1 R = 3, game 2 is 2 TB = 2. Dash played neither.
    await line(cruz, 1, { TOTAL_BASES: 2, RUNS: 1 });
    await line(cruz, 2, { TOTAL_BASES: 2 });

    const leaderboard = await board(contest.id, owner.headers);

    expect(leaderboard.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.totalScore])).toEqual([
      [sluggers.id, '1', 9],
      [speedsters.id, '2', 5],
    ]);
  });

  it('rescores the board when a stat line is corrected, and settles on the corrected lines', async () => {
    const { prisma, event, owner, contest, ace, cruz, line, sluggers, speedsters } = await seedContest();
    await line(ace, 1, { TOTAL_BASES: 4, RUNS: 1 });
    const cruzGame = await line(cruz, 1, { TOTAL_BASES: 2 });
    expect((await board(contest.id, owner.headers)).entries.map((entry) => [entry.entryId, entry.totalScore]))
      .toEqual([[sluggers.id, 5], [speedsters.id, 2]]);

    // The box score is corrected: Cruz's 2 total bases were a home run, 4 total bases, 1 run and 1 RBI.
    await prisma.sportEventParticipantStatLine.update({
      where: { participantRoundId_stat: { participantRoundId: cruzGame.id, stat: SportStat.TOTAL_BASES } },
      data: { value: 4 },
    });
    await prisma.sportEventParticipantStatLine.createMany({
      data: [
        { participantRoundId: cruzGame.id, stat: SportStat.RUNS, value: 1 },
        { participantRoundId: cruzGame.id, stat: SportStat.RUNS_BATTED_IN, value: 1 },
      ],
    });
    expect((await board(contest.id, owner.headers)).entries.map((entry) => [entry.entryId, entry.displayPosition, entry.totalScore]))
      .toEqual([[speedsters.id, '1', 6], [sluggers.id, '2', 5]]);

    await prisma.sportEvent.update({ where: { id: event.id }, data: { status: 'COMPLETED' } });
    await expect(createContestSettlementService(prisma).settleFinishedSportEvent(event.id))
      .resolves.toMatchObject({ contestsSettled: 1, contestsCompleted: 1, standingsUpserted: 2 });
    const standings = await prisma.contestEntryStanding.findMany({ where: { contestId: contest.id }, orderBy: { position: 'asc' } });
    expect(standings.map((row) => [row.contestEntryId, row.position, row.totalScore])).toEqual([
      [speedsters.id, 1, 6],
      [sluggers.id, 2, 5],
    ]);
  });
});

describe('applyEventGameStatLines (#935)', () => {
  /** A game's lines sent as the root admin, or as `headers`. */
  async function sendGame(eventId: string, game: number, rows: object[], headers: Record<string, string>) {
    return getApp().inject({ method: 'PUT', url: `/api/v1/events/${eventId}/rounds/${game}/stat-lines`, headers, payload: { rows } });
  }
  async function expectRefusal(response: Awaited<ReturnType<typeof sendGame>>, statusCode: number, code?: string) {
    expect(response.statusCode).toBe(statusCode);
    expect(ErrorEnvelopeSchema.safeParse(response.json()).success).toBe(true);
    if (code) expect(response.json<ErrorEnvelope>().error.code).toBe(code);
  }

  it('stores each player\'s line for the game as sent and returns the field with it, which the event\'s contests then score', async () => {
    const { event, ace, cruz } = await seedSeries();
    const admin = await createTestUser({ displayName: 'Stat Line Admin', isRootAdmin: true });

    const response = await sendGame(event.id, 1, [
      { participantId: ace.participantId, stats: [{ stat: SportStat.TOTAL_BASES, value: 4 }, { stat: SportStat.RUNS, value: 1 }] },
      { participantId: cruz.participantId, stats: [{ stat: SportStat.WALKS, value: 2 }] },
    ], admin.headers);

    expect(response.statusCode).toBe(200);
    const field = SportEventParticipantListResponseSchema.parse(response.json());
    const linesOf = (entryId: string) => field.participants.find((row) => row.id === entryId)?.rounds.map((round) => [round.roundNumber, round.status, round.statLines]);
    expect(linesOf(ace.id)).toEqual([[1, 'COMPLETED', [{ stat: SportStat.TOTAL_BASES, value: 4 }, { stat: SportStat.RUNS, value: 1 }]]]);
    expect(linesOf(cruz.id)).toEqual([[1, 'COMPLETED', [{ stat: SportStat.WALKS, value: 2 }]]]);
  });

  it('replaces a corrected player\'s whole line, clears an emptied one, and leaves players not named as they were', async () => {
    const { event, ace, blaze, cruz } = await seedSeries();
    const admin = await createTestUser({ displayName: 'Stat Line Corrector', isRootAdmin: true });
    await sendGame(event.id, 1, [
      { participantId: ace.participantId, stats: [{ stat: SportStat.TOTAL_BASES, value: 2 }, { stat: SportStat.RUNS, value: 1 }] },
      { participantId: blaze.participantId, stats: [{ stat: SportStat.STOLEN_BASES, value: 1 }] },
      { participantId: cruz.participantId, stats: [{ stat: SportStat.WALKS, value: 1 }] },
    ], admin.headers);

    const response = await sendGame(event.id, 1, [
      { participantId: ace.participantId, stats: [{ stat: SportStat.TOTAL_BASES, value: 4 }] },
      { participantId: blaze.participantId, stats: [] },
    ], admin.headers);

    const field = SportEventParticipantListResponseSchema.parse(response.json());
    const roundsOf = (entryId: string) => field.participants.find((row) => row.id === entryId)?.rounds.map((round) => round.statLines);
    expect(roundsOf(ace.id)).toEqual([[{ stat: SportStat.TOTAL_BASES, value: 4 }]]);
    expect(roundsOf(blaze.id)).toEqual([]);
    expect(roundsOf(cruz.id)).toEqual([[{ stat: SportStat.WALKS, value: 1 }]]);
  });

  it('refuses, writing nothing, a player off the field or named twice, a stat the Box Score does not count or given twice, an unscheduled game, an event not scored from stat lines, a bad value, and a member', async () => {
    const { prisma, event, ace } = await seedSeries();
    const admin = await createTestUser({ displayName: 'Stat Line Refusals', isRootAdmin: true });
    const member = await createTestUser({ displayName: 'Stat Line Member' });
    const runs = (value: number) => ({ stat: SportStat.RUNS, value });
    const golf = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const tour = await prisma.sportLeague.create({ data: { sportId: golf.id, name: `Tour ${randomUUID().slice(0, 8)}` } });
    const golfEvent = await prisma.sportEvent.create({
      data: {
        eventSeriesId: (await prisma.eventSeries.create({ data: { sportLeagueId: tour.id, name: `Open ${randomUUID().slice(0, 8)}` } })).id,
        eventYear: 2025,
        externalId: `stat-line-golf-${randomUUID().slice(0, 8)}`,
        providerId: 'manual-admin',
        sport: Sport.GOLF,
        name: 'Stat Line Open',
        startDate: new Date('2025-07-17T12:00:00.000Z'),
        status: 'IN_PROGRESS',
        rounds: 4,
      },
    });
    await prisma.sportEventRound.create({ data: { sportEventId: golfEvent.id, roundNumber: 1, scheduledDate: new Date('2025-07-17T12:00:00.000Z') } });

    await expectRefusal(await sendGame(event.id, 1, [{ participantId: randomUUID(), stats: [runs(1)] }], admin.headers), 422, 'STAT_LINE_ROWS_INVALID');
    await expectRefusal(await sendGame(event.id, 1, [{ participantId: ace.participantId, stats: [runs(1)] }, { participantId: ace.participantId, stats: [] }], admin.headers), 422, 'STAT_LINE_ROWS_INVALID');
    await expectRefusal(await sendGame(event.id, 1, [{ participantId: ace.participantId, stats: [{ stat: SportStat.POINTS, value: 30 }] }], admin.headers), 422, 'STAT_LINE_ROWS_INVALID');
    await expectRefusal(await sendGame(event.id, 1, [{ participantId: ace.participantId, stats: [runs(1), runs(2)] }], admin.headers), 422, 'STAT_LINE_ROWS_INVALID');
    await expectRefusal(await sendGame(event.id, 3, [{ participantId: ace.participantId, stats: [runs(1)] }], admin.headers), 422, 'ROUND_BEYOND_SCHEDULE');
    await expectRefusal(await sendGame(golfEvent.id, 1, [{ participantId: ace.participantId, stats: [runs(1)] }], admin.headers), 422, 'EVENT_SCORING_FAMILY_MISMATCH');
    await expectRefusal(await sendGame(event.id, 1, [{ participantId: ace.participantId, stats: [runs(-1)] }], admin.headers), 400);
    await expectRefusal(await sendGame(randomUUID(), 1, [{ participantId: ace.participantId, stats: [runs(1)] }], admin.headers), 404);
    await expectRefusal(await sendGame(event.id, 1, [{ participantId: ace.participantId, stats: [runs(1)] }], member.headers), 403);
    expect(await prisma.sportEventParticipantStatLine.count({ where: { participantRound: { sportEventParticipant: { sportEventId: event.id } } } })).toBe(0);
  });

  it('shows a stat pool league\'s overrides on its sport league and on its event, and none on its sport\'s own leagues', async () => {
    const { prisma, event } = await seedSeries();
    const admin = await createTestUser({ displayName: 'Stat Pool Reader', isRootAdmin: true });
    const baseball = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.BASEBALL } });
    const mlb = await prisma.sportLeague.create({ data: { sportId: baseball.id, name: `MLB ${randomUUID().slice(0, 8)}` } });
    const worldSeriesId = (await prisma.eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId } })).sportLeagueId;

    const leagues = SportLeagueListResponseSchema.parse((await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues?sport=BASEBALL', headers: admin.headers })).json());
    const read = SportEventResponseSchema.parse((await getApp().inject({ method: 'GET', url: `/api/v1/events/${event.id}`, headers: admin.headers })).json());

    const overridesOf = (id: string) => leagues.sportLeagues.filter((league) => league.id === id).map((league) => [league.participantType, league.scoringFamily]);
    expect(overridesOf(worldSeriesId)).toEqual([['INDIVIDUAL', ScoringFamily.COMPOSITE]]);
    expect(overridesOf(mlb.id)).toEqual([[null, null]]);
    expect([read.event.participantType, read.event.scoringFamily]).toEqual(['INDIVIDUAL', ScoringFamily.COMPOSITE]);
  });
});

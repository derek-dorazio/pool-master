import { testDomainEvents } from '../../support/domain-events';
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { GameSideStatus, Sport } from '@poolmaster/shared/domain';
import { ContestLeaderboardResponseSchema } from '@poolmaster/shared/dto';
import { PrismaRaceOrderRepository, PrismaSportEventParticipantRepository, PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { readFieldMatchIds } from '../../../packages/core-api/src/adapters/field-match-read';
import { createRoundRows } from '../../support/sport-event-rows';
import { createContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import { createRaceResultService } from '../../../packages/core-api/src/modules/events/wiring';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withBackgroundJobsFailing,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';

// The finish-position extension (#622) against real Postgres: what the admin's finishing order
// leaves in the tables, that it is all or none, the constraints the table holds on its own, and a
// horse racing contest read and settled from it. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const RUNNERS = ['Arrow', 'Bolt', 'Comet', 'Drift'];

/** A completed horse race with four runners on its field, the last one scratched. */
async function seedRace(status: 'SCHEDULED' | 'COMPLETED' = 'COMPLETED') {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  // cleanupTestData clears the sports table, the migration's reference row with it.
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.HORSE_RACING },
    create: { sport: Sport.HORSE_RACING, ...sportRowKeys(Sport.HORSE_RACING) },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma, { sport: Sport.HORSE_RACING })),
      name: `Harbour Stakes ${suffix}`,
      startDate: new Date('2026-05-02T22:00:00.000Z'),
      endDate: new Date('2026-05-02T22:05:00.000Z'),
      status,
      rounds: 1,
    },
  });
  await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: event.startDate }]);
  const field = [];
  for (const [index, name] of RUNNERS.entries()) {
    const participant = await prisma.participant.create({
      data: { sportLeagueId: await participantLeagueId(prisma, sport.id), name: `${name} ${suffix}`, participantType: 'INDIVIDUAL' },
    });
    field.push(await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, status: index < 3 ? 'ACTIVE' : 'WITHDRAWN' },
    }));
  }
  const [arrow, bolt, comet, drift] = field;
  return { prisma, suffix, event, arrow, bolt, comet, drift };
}

const write = (sportEventParticipantId: string, position: number | null, status: GameSideStatus = GameSideStatus.FINISHED) => ({
  sportEventParticipantId, position, status, startPosition: null,
});
const AT = new Date('2026-05-02T22:30:00.000Z');
const standing = (sportEventParticipantId: string, position: number | null) => ({
  sportEventParticipantId,
  position,
  displayPosition: position === null ? null : String(position),
  status: 'COMPLETE' as const,
  asOf: AT,
});

describe('RaceOrderRepository — the race as a FIELD match', () => {
  it('stores the results and each runner\'s standing, and reads back only the event\'s own results', async () => {
    const { prisma, event, arrow, bolt } = await seedRace();
    const other = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());

    await repo.applyOrder(event.id, {
      sides: [write(arrow.id, 1), { ...write(bolt.id, 2), startPosition: 5 }],
      isOfficial: false,
      at: AT,
      standings: [standing(arrow.id, 1), standing(bolt.id, 2)],
    });
    await repo.applyOrder(other.event.id, { sides: [write(other.arrow.id, 1)], isOfficial: false, at: AT, standings: [] });

    const results = await repo.findBySportEvent(event.id);
    expect(results.map((result) => [result.sportEventParticipantId, result.position, result.startPosition, result.isOfficial]))
      .toEqual([
        [arrow.id, 1, null, false],
        [bolt.id, 2, 5, false],
      ].sort(([left], [right]) => String(left).localeCompare(String(right))));
    const standings = await prisma.sportEventParticipantStanding.findMany({ where: { sportEventParticipant: { sportEventId: event.id } } });
    expect(standings.map((row) => [row.sportEventParticipantId, row.position, row.status]))
      .toEqual(expect.arrayContaining([[arrow.id, 1, 'COMPLETE'], [bolt.id, 2, 'COMPLETE']]));
    expect(standings).toHaveLength(2);
  });

  it('holds the race as one FIELD match in the event\'s first round, one Game, and a side numbered 1 to n per runner', async () => {
    const { prisma, event, arrow, bolt, comet } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());

    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1), write(bolt.id, 2)], isOfficial: false, at: AT, standings: [] });
    await repo.applyOrder(event.id, { sides: [write(comet.id, 3)], isOfficial: false, at: AT, standings: [] });

    const matches = await prisma.sportEventRoundMatch.findMany({
      where: { sportEventId: event.id },
      select: { status: true, sportEventRound: { select: { roundNumber: true } }, games: { select: { gameNumber: true, status: true } }, sides: { select: { sideNumber: true, sportEventParticipantId: true }, orderBy: { sideNumber: 'asc' } } },
    });
    expect(matches).toEqual([{
      status: 'IN_PROGRESS',
      sportEventRound: { roundNumber: 1 },
      games: [{ gameNumber: 1, status: 'IN_PROGRESS' }],
      sides: [
        { sideNumber: 1, sportEventParticipantId: expect.any(String) },
        { sideNumber: 2, sportEventParticipantId: expect.any(String) },
        { sideNumber: 3, sportEventParticipantId: comet.id },
      ],
    }]);
  });

  it('makes every result of the race official, including runners the write does not name, and stamps the Game completed', async () => {
    const { prisma, event, arrow, bolt } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());
    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1), write(bolt.id, 2)], isOfficial: false, at: AT, standings: [] });

    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1)], isOfficial: true, at: AT, standings: [] });

    expect((await repo.findBySportEvent(event.id)).map((result) => result.isOfficial)).toEqual([true, true]);
    await expect(prisma.sportEventRoundMatchGame.findFirstOrThrow({ where: { sportEventId: event.id }, select: { status: true, completedAt: true } }))
      .resolves.toEqual({ status: 'COMPLETED', completedAt: AT });
  });

  it('makes the race official and rewrites the standings when the write names no results, keeping the results already stored', async () => {
    const { prisma, event, arrow, bolt } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());
    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1), write(bolt.id, 2)], isOfficial: false, at: AT, standings: [] });

    await repo.applyOrder(event.id, { sides: [], isOfficial: true, at: AT, standings: [standing(arrow.id, 1)] });

    expect((await repo.findBySportEvent(event.id)).map((result) => [result.position, result.isOfficial]))
      .toEqual(expect.arrayContaining([[1, true], [2, true]]));
    const standings = await prisma.sportEventParticipantStanding.findMany({ where: { sportEventParticipant: { sportEventId: event.id } } });
    expect(standings.map((row) => [row.sportEventParticipantId, row.position])).toEqual([[arrow.id, 1]]);
  });

  it('writes nothing when one result names a field row that does not exist', async () => {
    const { prisma, event, arrow } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());

    await expect(repo.applyOrder(event.id, {
      sides: [write(arrow.id, 1), write(randomUUID(), 2)],
      isOfficial: false,
      at: AT,
      standings: [standing(arrow.id, 1)],
    })).rejects.toThrow();

    await expect(repo.findBySportEvent(event.id)).resolves.toEqual([]);
    await expect(prisma.sportEventRoundMatch.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(prisma.sportEventParticipantStanding.count({ where: { sportEventParticipantId: arrow.id } })).resolves.toBe(0);
  });

  it.each([
    ['a place below 1', { position: 0 }],
    ['a start position below 1', { startPosition: 0 }],
    ['a place on a runner that did not finish', { status: GameSideStatus.DID_NOT_FINISH, position: 2 }],
  ])('refuses %s at the database', async (_case, values) => {
    const { event, arrow } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());
    await expect(repo.applyOrder(event.id, { sides: [{ ...write(arrow.id, 1), ...values }], isOfficial: false, at: AT, standings: [] })).rejects.toThrow();
  });

  it('reads no FIELD match ids, and runs no statement, for no events', async () => {
    await expect(readFieldMatchIds(getAppPrisma(), [])).resolves.toEqual([]);
  });

  it('reads no results for an event with no race yet', async () => {
    const { event } = await seedRace();
    await expect(new PrismaRaceOrderRepository(getAppPrisma()).findBySportEvent(event.id)).resolves.toEqual([]);
  });

  it('reads back only the race\'s runners with a status, skipping a side with no field row and a side result with no status, and numbers the next runner after the highest side', async () => {
    const { prisma, event, arrow, bolt, comet } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());
    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1)], isOfficial: false, at: AT, standings: [] });
    const game = await prisma.sportEventRoundMatchGame.findFirstOrThrow({ where: { sportEventId: event.id }, select: { id: true, sportEventRoundMatchId: true } });
    const open = await prisma.sportEventRoundMatchSide.create({ data: { sportEventId: event.id, sportEventRoundMatchId: game.sportEventRoundMatchId, sideNumber: 8, sportEventParticipantId: null } });
    const unplaced = await prisma.sportEventRoundMatchSide.create({ data: { sportEventId: event.id, sportEventRoundMatchId: game.sportEventRoundMatchId, sideNumber: 9, sportEventParticipantId: bolt.id } });
    await prisma.sportEventRoundMatchGameSideResult.createMany({
      data: [
        { sportEventRoundMatchId: game.sportEventRoundMatchId, sportEventRoundMatchGameId: game.id, sportEventRoundMatchSideId: open.id, status: GameSideStatus.FINISHED, position: 2 },
        { sportEventRoundMatchId: game.sportEventRoundMatchId, sportEventRoundMatchGameId: game.id, sportEventRoundMatchSideId: unplaced.id, status: null },
      ],
    });

    await expect(repo.findBySportEvent(event.id).then((results) => results.map((result) => result.sportEventParticipantId))).resolves.toEqual([arrow.id]);

    await repo.applyOrder(event.id, { sides: [write(comet.id, 3)], isOfficial: false, at: AT, standings: [] });
    await expect(prisma.sportEventRoundMatchSide.findFirstOrThrow({ where: { sportEventParticipantId: comet.id }, select: { sideNumber: true } })).resolves.toEqual({ sideNumber: 10 });
  });

  it('refuses a race on an event with no round, writing nothing', async () => {
    const { prisma, event, arrow } = await seedRace();
    await prisma.sportEventRound.deleteMany({ where: { sportEventId: event.id } });

    await expect(new PrismaRaceOrderRepository(getAppPrisma()).applyOrder(event.id, { sides: [write(arrow.id, 1)], isOfficial: false, at: AT, standings: [standing(arrow.id, 1)] }))
      .rejects.toThrow('has no round to hold its race');
    await expect(prisma.sportEventParticipantStanding.count({ where: { sportEventParticipantId: arrow.id } })).resolves.toBe(0);
  });

  it('refuses a write to a race whose Game 1 is missing, leaving its results as they were', async () => {
    const { prisma, event, arrow, bolt } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());
    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1)], isOfficial: false, at: AT, standings: [] });
    await prisma.sportEventRoundMatchGame.deleteMany({ where: { sportEventId: event.id } });

    await expect(repo.applyOrder(event.id, { sides: [write(bolt.id, 2)], isOfficial: true, at: AT, standings: [] })).rejects.toThrow('has no Game');
    await expect(prisma.sportEventRoundMatchSide.count({ where: { sportEventParticipantId: bolt.id } })).resolves.toBe(0);
  });

  it('removes a runner\'s side and result with its field row', async () => {
    const { prisma, event, arrow } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());
    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1)], isOfficial: false, at: AT, standings: [] });

    await new PrismaSportEventParticipantRepository(getAppPrisma()).delete(arrow.id);

    await expect(prisma.sportEventRoundMatchSide.count({ where: { sportEventParticipantId: arrow.id } })).resolves.toBe(0);
    await expect(repo.findBySportEvent(event.id)).resolves.toEqual([]);
  });
});

describe('RaceOrderRepository — the leaderboard rebuild a result carries (#1466)', () => {
  it('commits the rebuild job with the result', async () => {
    const { prisma, event, arrow } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());

    await repo.applyOrder(event.id, { sides: [write(arrow.id, 1)], isOfficial: true, at: AT, standings: [standing(arrow.id, 1)], jobs: [eventRebuildJob(event.id)] });

    await expect(prisma.backgroundJob.count({ where: { dedupeKey: eventRebuildJob(event.id).dedupeKey } })).resolves.toBe(1);
  });

  it('stores no result and no standing when the rebuild job cannot be written', async () => {
    const { prisma, event, arrow } = await seedRace();
    const repo = new PrismaRaceOrderRepository(getAppPrisma());

    await expect(withBackgroundJobsFailing('REBUILD_LEADERBOARDS', () => repo.applyOrder(event.id, {
      sides: [write(arrow.id, 1)], isOfficial: true, at: AT, standings: [standing(arrow.id, 1)], jobs: [eventRebuildJob(event.id)],
    }))).rejects.toThrow();

    await expect(repo.findBySportEvent(event.id)).resolves.toEqual([]);
    await expect(prisma.sportEventParticipantStanding.count({ where: { sportEventParticipantId: arrow.id } })).resolves.toBe(0);
  });
});

describe('horse racing contest — read and settled from the finishing order', () => {
  async function seedContest() {
    const race = await seedRace();
    const { prisma, suffix, event, arrow, bolt, comet, drift } = race;
    const owner = await createTestUser({ displayName: `Race Owner ${suffix}` });
    const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `HRS${suffix.toUpperCase()}`, name: `Paddock League ${suffix}` } });
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
    });
    const [squadOne, squadTwo] = await Promise.all([1, 2].map((number) => prisma.squad.create({
      data: { leagueId: league.id, createdBy: owner.user.id, name: `Stable ${number} ${suffix}` },
    })));
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id, seasonYear: 2026, sportEvents: { create: { sportEventId: event.id, sequence: 1 } }, name: `Win Place Show ${suffix}`,
        status: 'ACTIVE', contestFormat: 'ROSTER', selectionType: 'BUDGET_PICK',
      },
    });
    await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'BUDGET_PICK',
        configJson: { selectionType: 'BUDGET_PICK', rosterSize: 2, countedScores: 2, salaryCap: 100 },
        participantScoringRules: {
          create: {
            participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
            sortOrder: 1,
            config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 },
          },
        },
      },
    });
    const [winners, scratch] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squadOne.id, entryNumber: 1, name: 'Arrow and Comet', events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } } } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squadTwo.id, entryNumber: 1, name: 'Bolt and Drift', events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } } } }),
    ]);
    await prisma.contestEntryPick.createMany({
      data: [
        { entryId: winners.id, sportEventParticipantId: arrow.id },
        { entryId: winners.id, sportEventParticipantId: comet.id },
        { entryId: scratch.id, sportEventParticipantId: bolt.id },
        { entryId: scratch.id, sportEventParticipantId: drift.id },
      ],
    });
    return { ...race, owner, contest, winners, scratch };
  }

  const officialOrder = (race: { arrow: { participantId: string }; bolt: { participantId: string }; comet: { participantId: string } }) => ({
    isOfficial: true,
    rows: [
      { participantId: race.arrow.participantId, resultStatus: GameSideStatus.FINISHED, finishPosition: 1, startPosition: null },
      { participantId: race.bolt.participantId, resultStatus: GameSideStatus.FINISHED, finishPosition: 2, startPosition: null },
      { participantId: race.comet.participantId, resultStatus: GameSideStatus.FINISHED, finishPosition: 3, startPosition: null },
    ],
  });

  it('ranks entries by points, higher first, with a scratched pick scoring the did-not-finish points', async () => {
    const seeded = await seedContest();
    const { suffix, event, owner, contest, winners, scratch } = seeded;
    await createRaceResultService(getAppPrisma(), testDomainEvents()).applyResults(event.id, officialOrder(seeded));

    const response = await getApp().inject({ method: 'GET', url: `/api/v1/contests/${contest.id}/leaderboard`, headers: owner.headers });

    expect(response.statusCode).toBe(200);
    const board = ContestLeaderboardResponseSchema.parse(response.json());
    expect(board.scoringDefinitionId).toBe('FINISH_POSITION_POINTS');
    expect(board.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.totalScore])).toEqual([
      [winners.id, '1', 6],
      [scratch.id, '2', 3],
    ]);
    expect(board.participants.find((participant) => participant.participant.name === `Arrow ${suffix}`)?.race)
      .toMatchObject({ finishPosition: 1, resultStatus: 'FINISHED', isOfficial: true });
  });

  it('shows no points on the board while the result is provisional', async () => {
    const seeded = await seedContest();
    const { event, owner, contest } = seeded;
    await createRaceResultService(getAppPrisma(), testDomainEvents()).applyResults(event.id, { ...officialOrder(seeded), isOfficial: false });

    const response = await getApp().inject({ method: 'GET', url: `/api/v1/contests/${contest.id}/leaderboard`, headers: owner.headers });

    const board = ContestLeaderboardResponseSchema.parse(response.json());
    expect(board.entries.map((entry) => entry.totalScore)).toEqual([null, null]);
  });

  it('settles the contest, freezing each entry\'s points as its standing total, and the completed board reads them back', async () => {
    const seeded = await seedContest();
    const { prisma, event, owner, contest, winners, scratch } = seeded;
    await createRaceResultService(getAppPrisma(), testDomainEvents()).applyResults(event.id, officialOrder(seeded));

    await expect(createContestSettlementService(getAppPrisma(), undefined, { domainEvents: testDomainEvents() }).settleFinishedSportEvent(event.id))
      .resolves.toMatchObject({ contestsSettled: 1, contestsCompleted: 1, standingsUpserted: 2 });

    const standings = await prisma.contestEntryStanding.findMany({
      where: { contestId: contest.id },
      orderBy: { position: 'asc' },
    });
    expect(standings.map((row) => [row.contestEntryId, row.position, row.totalScore])).toEqual([
      [winners.id, 1, 6],
      [scratch.id, 2, 3],
    ]);
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: contest.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'COMPLETED' });

    const response = await getApp().inject({ method: 'GET', url: `/api/v1/contests/${contest.id}/leaderboard`, headers: owner.headers });
    const board = ContestLeaderboardResponseSchema.parse(response.json());
    expect(board.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.totalScore])).toEqual([
      [winners.id, '1', 6],
      [scratch.id, '2', 3],
    ]);
  });
});

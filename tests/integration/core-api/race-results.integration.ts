import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { RaceResultStatus, Sport } from '@poolmaster/shared/domain';
import { ContestLeaderboardResponseSchema } from '@poolmaster/shared/dto';
import { PrismaSportEventParticipantRaceResultRepository } from '../../../packages/core-api/src/adapters';
import { createContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import { createRaceResultService } from '../../../packages/core-api/src/modules/events/wiring';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';

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
    create: { sport: Sport.HORSE_RACING, participantType: 'INDIVIDUAL', tournamentFormat: 'RACE' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `race-${suffix}`,
      providerId: 'manual-admin',
      sport: Sport.HORSE_RACING,
      name: `Harbour Stakes ${suffix}`,
      startDate: new Date('2026-05-02T22:00:00.000Z'),
      endDate: new Date('2026-05-02T22:05:00.000Z'),
      status,
      rounds: 1,
    },
  });
  const field = [];
  for (const [index, name] of RUNNERS.entries()) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL' },
    });
    field.push(await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, isActive: index < 3 },
    }));
  }
  const [arrow, bolt, comet, drift] = field;
  return { prisma, suffix, event, arrow, bolt, comet, drift };
}

const write = (sportEventParticipantId: string, finishPosition: number | null, resultStatus: RaceResultStatus = RaceResultStatus.FINISHED) => ({
  sportEventParticipantId, finishPosition, resultStatus, startPosition: null, riderName: null,
});
const standing = (sportEventParticipantId: string, position: number | null) => ({
  sportEventParticipantId,
  position,
  displayPosition: position === null ? null : String(position),
  status: 'COMPLETE' as const,
  currentRound: null,
  asOf: new Date('2026-05-02T22:30:00.000Z'),
});

describe('SportEventParticipantRaceResultRepository', () => {
  it('stores the results and each runner\'s standing, and reads back only the event\'s own results', async () => {
    const { prisma, event, arrow, bolt } = await seedRace();
    const other = await seedRace();
    const repo = new PrismaSportEventParticipantRaceResultRepository(prisma);

    await repo.applyResults(event.id, {
      results: [write(arrow.id, 1), { ...write(bolt.id, 2), startPosition: 5, riderName: 'J. Velez' }],
      isOfficial: false,
      standings: [standing(arrow.id, 1), standing(bolt.id, 2)],
    });
    await repo.applyResults(other.event.id, { results: [write(other.arrow.id, 1)], isOfficial: false, standings: [] });

    const results = await repo.findBySportEvent(event.id);
    expect(results.map((result) => [result.sportEventParticipantId, result.finishPosition, result.startPosition, result.riderName, result.isOfficial]))
      .toEqual([
        [arrow.id, 1, null, null, false],
        [bolt.id, 2, 5, 'J. Velez', false],
      ].sort(([left], [right]) => String(left).localeCompare(String(right))));
    const standings = await prisma.sportEventParticipantStanding.findMany({ where: { sportEventParticipant: { sportEventId: event.id } } });
    expect(standings.map((row) => [row.sportEventParticipantId, row.position, row.status]))
      .toEqual(expect.arrayContaining([[arrow.id, 1, 'COMPLETE'], [bolt.id, 2, 'COMPLETE']]));
    expect(standings).toHaveLength(2);
  });

  it('sets the official flag on every result of the race, including runners the write does not name', async () => {
    const { prisma, event, arrow, bolt } = await seedRace();
    const repo = new PrismaSportEventParticipantRaceResultRepository(prisma);
    await repo.applyResults(event.id, { results: [write(arrow.id, 1), write(bolt.id, 2)], isOfficial: false, standings: [] });

    await repo.applyResults(event.id, { results: [write(arrow.id, 1)], isOfficial: true, standings: [] });

    expect((await repo.findBySportEvent(event.id)).map((result) => result.isOfficial)).toEqual([true, true]);
  });

  it('writes nothing when one result names a field row that does not exist', async () => {
    const { prisma, event, arrow } = await seedRace();
    const repo = new PrismaSportEventParticipantRaceResultRepository(prisma);

    await expect(repo.applyResults(event.id, {
      results: [write(arrow.id, 1), write(randomUUID(), 2)],
      isOfficial: false,
      standings: [standing(arrow.id, 1)],
    })).rejects.toThrow();

    await expect(repo.findBySportEvent(event.id)).resolves.toEqual([]);
    await expect(prisma.sportEventParticipantStanding.count({ where: { sportEventParticipantId: arrow.id } })).resolves.toBe(0);
  });

  it.each([
    ['a place below 1', { finishPosition: 0 }],
    ['a start position below 1', { startPosition: 0 }],
    ['a place on a runner that did not finish', { resultStatus: RaceResultStatus.DID_NOT_FINISH, finishPosition: 2 }],
    ['an official finisher with no place', { finishPosition: null, isOfficial: true }],
  ])('refuses %s at the database', async (_case, values) => {
    const { prisma, arrow } = await seedRace();
    await expect(prisma.sportEventParticipantRaceResult.create({
      data: { sportEventParticipantId: arrow.id, resultStatus: RaceResultStatus.FINISHED, finishPosition: 1, ...values },
    })).rejects.toThrow();
  });

  it('removes a runner\'s result with its field row', async () => {
    const { prisma, event, arrow } = await seedRace();
    const repo = new PrismaSportEventParticipantRaceResultRepository(prisma);
    await repo.applyResults(event.id, { results: [write(arrow.id, 1)], isOfficial: false, standings: [] });

    await prisma.sportEventParticipant.delete({ where: { id: arrow.id } });

    await expect(prisma.sportEventParticipantRaceResult.count({ where: { sportEventParticipantId: arrow.id } })).resolves.toBe(0);
  });
});

describe('horse racing contest — read and settled from the finishing order', () => {
  async function seedContest() {
    const race = await seedRace();
    const { prisma, suffix, event, arrow, bolt, comet, drift } = race;
    const owner = await createTestUser({ displayName: `Race Owner ${suffix}` });
    const league = await prisma.league.create({ data: { leagueCode: `HRS${suffix.toUpperCase()}`, name: `Paddock League ${suffix}` } });
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
    });
    const [squadOne, squadTwo] = await Promise.all([1, 2].map((number) => prisma.squad.create({
      data: { leagueId: league.id, createdBy: owner.user.id, name: `Stable ${number} ${suffix}` },
    })));
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id, sportEvents: { create: { sportEventId: event.id, sequence: 1 } }, name: `Win Place Show ${suffix}`,
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
        { entryId: winners.id, sportEventParticipantId: arrow.id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: winners.id, sportEventParticipantId: comet.id, contestFormat: 'ROSTER', slot: 2 },
        { entryId: scratch.id, sportEventParticipantId: bolt.id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: scratch.id, sportEventParticipantId: drift.id, contestFormat: 'ROSTER', slot: 2 },
      ],
    });
    return { ...race, owner, contest, winners, scratch };
  }

  const officialOrder = (suffix: string) => ({
    isOfficial: true,
    rows: [
      { playerName: `Arrow ${suffix}`, resultStatus: RaceResultStatus.FINISHED, finishPosition: 1, startPosition: null, riderName: null },
      { playerName: `Bolt ${suffix}`, resultStatus: RaceResultStatus.FINISHED, finishPosition: 2, startPosition: null, riderName: null },
      { playerName: `Comet ${suffix}`, resultStatus: RaceResultStatus.FINISHED, finishPosition: 3, startPosition: null, riderName: null },
    ],
  });

  it('ranks entries by points, higher first, with a scratched pick scoring the did-not-finish points', async () => {
    const { prisma, suffix, event, owner, contest, winners, scratch } = await seedContest();
    await createRaceResultService(prisma).applyResults(event.id, officialOrder(suffix));

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
    const { prisma, suffix, event, owner, contest } = await seedContest();
    await createRaceResultService(prisma).applyResults(event.id, { ...officialOrder(suffix), isOfficial: false });

    const response = await getApp().inject({ method: 'GET', url: `/api/v1/contests/${contest.id}/leaderboard`, headers: owner.headers });

    const board = ContestLeaderboardResponseSchema.parse(response.json());
    expect(board.entries.map((entry) => entry.totalScore)).toEqual([null, null]);
  });

  it('settles the contest, freezing each entry\'s points as its standing total, and the completed board reads them back', async () => {
    const { prisma, suffix, event, owner, contest, winners, scratch } = await seedContest();
    await createRaceResultService(prisma).applyResults(event.id, officialOrder(suffix));

    await expect(createContestSettlementService(prisma).settleCompletedSportEvent(event.id))
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

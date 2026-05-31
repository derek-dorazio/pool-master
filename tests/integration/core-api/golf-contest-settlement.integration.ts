import { randomUUID } from 'node:crypto';
import { EventBus } from '@poolmaster/shared/events/event-bus';
import { Sport } from '@poolmaster/shared/domain';
import { GolfContestSettlementService } from '../../../packages/core-api/src/modules/contests/golf-contest-settlement-service';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterEach(() => cleanupTestData());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('pool-master-eux.6: schedule-driven Golf contest settlement', () => {
  it('pool-master-eux.6: freezes final standings, completes direct and joined contests, and is idempotent', async () => {
    const prisma = getPrisma();
    const bus = new EventBus();
    const completedEvents: unknown[] = [];
    bus.subscribe('contest.completed', async (event) => {
      completedEvents.push(event);
    });
    const service = new GolfContestSettlementService(prisma, undefined, bus);
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `Golf Settlement ${suffix}` });
    const sport = await prisma.sport.upsert({
      where: { name: Sport.GOLF },
      create: {
        name: Sport.GOLF,
        participantType: 'INDIVIDUAL',
      },
      update: {},
    });
    const league = await prisma.league.create({
      data: {
        leagueCode: `GST${suffix.toUpperCase()}`,
        name: `Golf Settlement League ${suffix}`,
        createdBy: owner.user.id,
      },
    });
    await prisma.leagueMembership.create({
      data: {
        leagueId: league.id,
        userId: owner.user.id,
        role: 'COMMISSIONER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    const [squadOne, squadTwo] = await Promise.all([
      prisma.squad.create({
        data: {
          leagueId: league.id,
          createdBy: owner.user.id,
          name: `Settlement One ${suffix}`,
        },
      }),
      prisma.squad.create({
        data: {
          leagueId: league.id,
          createdBy: owner.user.id,
          name: `Settlement Two ${suffix}`,
        },
      }),
    ]);
    const event = await prisma.sportEvent.create({
      data: {
        externalId: `golf-settlement-event-${suffix}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: `Golf Settlement Invitational ${suffix}`,
        startDate: new Date('2026-05-28T12:00:00.000Z'),
        endDate: new Date('2026-05-31T22:00:00.000Z'),
        status: 'COMPLETED',
        releaseAt: new Date('2026-05-20T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-05-27T16:00:00.000Z'),
        fieldLocked: true,
      },
    });
    const participants = await Promise.all([
      createSettlementParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        name: `Winner A ${suffix}`,
        scoreToPar: -7,
        strokes: 281,
      }),
      createSettlementParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        name: `Counter B ${suffix}`,
        scoreToPar: -2,
        strokes: 286,
      }),
      createSettlementParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        name: `Dropped C ${suffix}`,
        scoreToPar: 3,
        strokes: 291,
      }),
    ]);
    const [directContest, joinedContest] = await Promise.all([
      createSettlementContest({
        leagueId: league.id,
        sportEventId: event.id,
        name: `Direct Settlement ${suffix}`,
      }),
      createSettlementContest({
        leagueId: league.id,
        sportEventId: null,
        name: `Joined Settlement ${suffix}`,
      }),
    ]);
    await prisma.contestSportEvent.create({
      data: {
        contestId: joinedContest.id,
        sportEventId: event.id,
      },
    });
    const directEntries = await createSettlementEntries({
      contestId: directContest.id,
      squadOneId: squadOne.id,
      squadTwoId: squadTwo.id,
      participants: participants.map((participant) => participant.id),
    });
    const joinedEntries = await createSettlementEntries({
      contestId: joinedContest.id,
      squadOneId: squadOne.id,
      squadTwoId: squadTwo.id,
      participants: participants.map((participant) => participant.id),
    });

    const first = await service.settleCompletedSportEvent(event.id);

    expect(first).toEqual({
      sportEventId: event.id,
      contestsSettled: 2,
      contestsCompleted: 2,
      standingsUpserted: 4,
    });
    await expect(prisma.contest.findMany({
      where: { id: { in: [directContest.id, joinedContest.id] } },
      select: { status: true, endsAt: true },
      orderBy: { id: 'asc' },
    })).resolves.toEqual([
      { status: 'COMPLETED', endsAt: new Date('2026-05-31T22:00:00.000Z') },
      { status: 'COMPLETED', endsAt: new Date('2026-05-31T22:00:00.000Z') },
    ]);
    expect(completedEvents).toHaveLength(2);
    const standings = await prisma.contestEntryGolfStanding.findMany({
      where: { contestId: directContest.id },
      orderBy: { position: 'asc' },
    });
    expect(standings.map((standing) => ({
      contestEntryId: standing.contestEntryId,
      totalScoreToPar: standing.totalScoreToPar,
      position: standing.position,
      displayPosition: standing.displayPosition,
      countingPickCount: standing.countingPickCount,
      scoredPickCount: standing.scoredPickCount,
      status: standing.status,
    }))).toEqual([
      {
        contestEntryId: directEntries.winner.id,
        totalScoreToPar: -9,
        position: 1,
        displayPosition: '1',
        countingPickCount: 2,
        scoredPickCount: 3,
        status: 'FINAL',
      },
      {
        contestEntryId: directEntries.runnerUp.id,
        totalScoreToPar: 1,
        position: 2,
        displayPosition: '2',
        countingPickCount: 2,
        scoredPickCount: 2,
        status: 'FINAL',
      },
    ]);

    const second = await service.settleCompletedSportEvent(event.id);

    expect(second).toEqual({
      sportEventId: event.id,
      contestsSettled: 2,
      contestsCompleted: 0,
      standingsUpserted: 4,
    });
    await expect(prisma.contestEntryGolfStanding.count({
      where: {
        contestEntryId: {
          in: [
            directEntries.winner.id,
            directEntries.runnerUp.id,
            joinedEntries.winner.id,
            joinedEntries.runnerUp.id,
          ],
        },
      },
    })).resolves.toBe(4);
    expect(completedEvents).toHaveLength(2);

    const historyResponse = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${directContest.id}/history/summary`,
      headers: owner.headers,
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toEqual(expect.objectContaining({
      contestId: directContest.id,
      contestName: directContest.name,
      sport: Sport.GOLF,
      contestFormat: 'ROSTER',
      numEntries: 2,
      finalStandings: expect.arrayContaining([
        expect.objectContaining({
          contestId: directContest.id,
          entryId: directEntries.winner.id,
          finalRank: 1,
          finalScoreToPar: -9,
          isWinner: true,
        }),
        expect.objectContaining({
          contestId: directContest.id,
          entryId: directEntries.runnerUp.id,
          finalRank: 2,
          finalScoreToPar: 1,
          isWinner: false,
        }),
      ]),
    }));
  });
});

async function createSettlementParticipant(input: {
  sportId: string;
  sportEventId: string;
  name: string;
  scoreToPar: number;
  strokes: number;
}) {
  const prisma = getPrisma();
  const participant = await prisma.participant.create({
    data: {
      sportId: input.sportId,
      name: input.name,
      participantType: 'INDIVIDUAL',
      status: 'ACTIVE',
    },
  });
  const sportEventParticipant = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: input.sportEventId,
      participantId: participant.id,
      status: 'ACTIVE',
    },
  });
  await prisma.sportEventParticipantGolfStanding.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      eventScoreToPar: input.scoreToPar,
      eventStrokes: input.strokes,
      currentRound: 4,
      currentRoundThru: 18,
      status: 'COMPLETE',
      asOf: new Date('2026-05-31T22:00:00.000Z'),
    },
  });
  return sportEventParticipant;
}

async function createSettlementContest(input: {
  leagueId: string;
  sportEventId: string | null;
  name: string;
}) {
  const prisma = getPrisma();
  const contest = await prisma.contest.create({
    data: {
      leagueId: input.leagueId,
      sportEventId: input.sportEventId,
      name: input.name,
      status: 'ACTIVE',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: 'TIERED',
      configJson: { countedScores: 2 },
      rosterSize: 3,
      pickCount: 3,
    },
  });
  return contest;
}

async function createSettlementEntries(input: {
  contestId: string;
  squadOneId: string;
  squadTwoId: string;
  participants: string[];
}) {
  const prisma = getPrisma();
  const [winner, runnerUp] = await Promise.all([
    prisma.contestEntry.create({
      data: {
        contestId: input.contestId,
        squadId: input.squadOneId,
        entryNumber: 1,
        name: 'Winner',
        status: 'ACTIVE',
      },
    }),
    prisma.contestEntry.create({
      data: {
        contestId: input.contestId,
        squadId: input.squadTwoId,
        entryNumber: 2,
        name: 'Runner Up',
        status: 'ACTIVE',
      },
    }),
  ]);
  await prisma.contestEntryPick.createMany({
    data: [
      {
        entryId: winner.id,
        sportEventParticipantId: input.participants[0],
        contestFormat: 'ROSTER',
        slot: 1,
      },
      {
        entryId: winner.id,
        sportEventParticipantId: input.participants[1],
        contestFormat: 'ROSTER',
        slot: 2,
      },
      {
        entryId: winner.id,
        sportEventParticipantId: input.participants[2],
        contestFormat: 'ROSTER',
        slot: 3,
      },
      {
        entryId: runnerUp.id,
        sportEventParticipantId: input.participants[1],
        contestFormat: 'ROSTER',
        slot: 1,
      },
      {
        entryId: runnerUp.id,
        sportEventParticipantId: input.participants[2],
        contestFormat: 'ROSTER',
        slot: 2,
      },
    ],
  });
  return { winner, runnerUp };
}

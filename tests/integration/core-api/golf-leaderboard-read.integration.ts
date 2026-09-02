import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { GolfLeaderboardResponseSchema } from '@poolmaster/shared/dto';
import { Sport } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('pool-master-eux.4: Golf leaderboard read API', () => {
  it('returns a Golf leaderboard ranked from event standings with counting and dropped picks', async () => {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `Golf Leaderboard ${suffix}` });
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
        leagueCode: `GLB${suffix.toUpperCase()}`,
        name: `Golf Leaderboard League ${suffix}`,
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
          name: `Ryans Gonna Win ${suffix}`,
        },
      }),
      prisma.squad.create({
        data: {
          leagueId: league.id,
          createdBy: owner.user.id,
          name: `Lets Go Cam ${suffix}`,
        },
      }),
    ]);
    await prisma.squadMembership.create({
      data: {
        leagueId: league.id,
        squadId: squadOne.id,
        userId: owner.user.id,
        status: 'ACTIVE',
      },
    });
    const event = await prisma.sportEvent.create({
      data: {
        externalId: `golf-leaderboard-event-${suffix}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: `Golf Leaderboard Invitational ${suffix}`,
        startDate: new Date('2026-05-28T12:00:00.000Z'),
        endDate: new Date('2026-05-31T22:00:00.000Z'),
        status: 'IN_PROGRESS',
        releaseAt: new Date('2026-05-20T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-05-27T16:00:00.000Z'),
        fieldLocked: true,
      },
    });
    const participants = await Promise.all([
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        name: `Rory ${suffix}`,
        scoreToPar: -5,
        strokes: 139,
        status: 'IN_PROGRESS',
        thru: 9,
      }),
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        name: `Scottie ${suffix}`,
        scoreToPar: -2,
        strokes: 142,
        status: 'COMPLETE',
      }),
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        name: `Jordan ${suffix}`,
        scoreToPar: 1,
        strokes: 145,
        status: 'COMPLETE',
      }),
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        name: `Ludvig ${suffix}`,
        scoreToPar: -7,
        strokes: 137,
        status: 'COMPLETE',
      }),
    ]);
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        sportEventId: event.id,
        name: `Golf Leaderboard Contest ${suffix}`,
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
        configJson: {
          countedScores: 2,
        },
        rosterSize: 3,
        pickCount: 3,
      },
    });
    const [entryOne, entryTwo] = await Promise.all([
      prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          squadId: squadOne.id,
          entryNumber: 1,
          name: `Standing Runner-Up ${suffix}`,
          status: 'ACTIVE',
        },
      }),
      prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          squadId: squadTwo.id,
          entryNumber: 1,
          name: `Standing Winner ${suffix}`,
          status: 'ACTIVE',
        },
      }),
    ]);
    await Promise.all([
      createGolfLeaderboardPick(entryOne.id, participants[0].id, 1),
      createGolfLeaderboardPick(entryOne.id, participants[1].id, 2),
      createGolfLeaderboardPick(entryOne.id, participants[2].id, 3),
      createGolfLeaderboardPick(entryTwo.id, participants[3].id, 1),
      createGolfLeaderboardPick(entryTwo.id, participants[1].id, 2),
      createGolfLeaderboardPick(entryTwo.id, participants[2].id, 3),
    ]);

    const response = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contest.id}/golf/leaderboard`,
      headers: owner.headers,
    });

    expect(response.statusCode).toBe(200);
    const parsed = GolfLeaderboardResponseSchema.parse(response.json());
    expect(parsed.entries.map((entry) => [entry.entryId, entry.totalScoreToPar, entry.position])).toEqual([
      [entryTwo.id, -9, 1],
      [entryOne.id, -7, 2],
    ]);
    expect(parsed.entries[0].picks.map((pick) => ({
      participantId: pick.sportEventParticipantId,
      isCounting: pick.isCounting,
      isDropped: pick.isDropped,
    }))).toEqual([
      { participantId: participants[3].id, isCounting: true, isDropped: false },
      { participantId: participants[1].id, isCounting: true, isDropped: false },
      { participantId: participants[2].id, isCounting: false, isDropped: true },
    ]);
    const rory = parsed.participants.find((participant) => participant.sportEventParticipantId === participants[0].id);
    expect(rory).toEqual(expect.objectContaining({
      totalScoreToPar: -5,
      thru: 9,
      status: 'in-progress',
    }));
    expect(rory?.rounds.r2).toEqual(expect.objectContaining({
      displayType: 'TO_PAR',
      displayValue: '-2',
      thru: 9,
    }));
  });
});

async function createGolfLeaderboardParticipant(input: {
  sportId: string;
  sportEventId: string;
  name: string;
  scoreToPar: number;
  strokes: number;
  status: 'COMPLETE' | 'IN_PROGRESS';
  thru?: number;
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
      isActive: true,
    },
  });
  const [round1, round2] = await Promise.all([
    prisma.sportEventRound.upsert({
      where: { sportEventId_roundNumber: { sportEventId: input.sportEventId, roundNumber: 1 } },
      create: { sportEventId: input.sportEventId, roundNumber: 1, scheduledDate: new Date('2026-04-09T12:00:00.000Z') },
      update: {},
    }),
    prisma.sportEventRound.upsert({
      where: { sportEventId_roundNumber: { sportEventId: input.sportEventId, roundNumber: 2 } },
      create: { sportEventId: input.sportEventId, roundNumber: 2, scheduledDate: new Date('2026-04-10T12:00:00.000Z') },
      update: {},
    }),
  ]);
  await prisma.sportEventParticipantGolfRound.createMany({
    data: [
      {
        sportEventParticipantId: sportEventParticipant.id,
        sportEventRoundId: round1.id,
        strokes: input.strokes - 47,
        scoreToPar: input.scoreToPar + 2,
        status: 'COMPLETED',
      },
      {
        sportEventParticipantId: sportEventParticipant.id,
        sportEventRoundId: round2.id,
        strokes: 47,
        scoreToPar: -2,
        thru: input.status === 'IN_PROGRESS' ? input.thru ?? null : null,
        status: input.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'COMPLETED',
      },
    ],
  });
  await prisma.sportEventParticipantGolfStanding.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      eventScoreToPar: input.scoreToPar,
      eventStrokes: input.strokes,
      currentRound: 2,
      currentRoundThru: input.status === 'IN_PROGRESS' ? input.thru ?? null : 18,
      status: input.status,
      asOf: new Date('2026-05-31T18:00:00.000Z'),
    },
  });
  return sportEventParticipant;
}

async function createGolfLeaderboardPick(entryId: string, sportEventParticipantId: string, slot: number) {
  return getPrisma().contestEntryPick.create({
    data: {
      entryId,
      sportEventParticipantId,
      contestFormat: 'ROSTER',
      slot,
    },
  });
}

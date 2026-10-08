import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import { createGolfContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterEach(() => cleanupTestData());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('pool-master-eux.6: schedule-driven Golf contest settlement', () => {
  it('pool-master-eux.6: freezes final standings, completes the sport event\'s contests, and is idempotent', async () => {
    const prisma = getPrisma();
    const service = createGolfContestSettlementService(prisma);
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `Golf Settlement ${suffix}` });
    const sport = await prisma.sport.upsert({
      where: { name: Sport.GOLF },
      create: {
        name: Sport.GOLF,
        participantType: 'INDIVIDUAL',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });
    const league = await prisma.league.create({
      data: {
        leagueCode: `GST${suffix.toUpperCase()}`,
        name: `Golf Settlement League ${suffix}`,
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
        ...(await freshEventEdition(prisma)),
        externalId: `golf-settlement-event-${suffix}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: `Golf Settlement Invitational ${suffix}`,
        startDate: new Date('2026-05-28T12:00:00.000Z'),
        endDate: new Date('2026-05-31T22:00:00.000Z'),
        status: 'COMPLETED',
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
    const [directContest, invalidContest, noRuleContest] = await Promise.all([
      createSettlementContest({
        leagueId: league.id,
        sportEventId: event.id,
        name: `Direct Settlement ${suffix}`,
      }),
      prisma.contest.create({
        data: {
          leagueId: league.id,
          sportEventId: event.id,
          name: `Invalid Settlement ${suffix}`,
          status: 'ACTIVE',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          scoringEngine: 'STROKE_PLAY',
        },
      }),
      // #246: the golf fallback is gone, so a configuration without a scoring rule is
      // skipped rather than settled under an assumed direction.
      createSettlementContest({
        leagueId: league.id,
        sportEventId: event.id,
        name: `No Rule Settlement ${suffix}`,
        withScoringRule: false,
      }),
    ]);
    const directEntries = await createSettlementEntries({
      contestId: directContest.id,
      squadOneId: squadOne.id,
      squadTwoId: squadTwo.id,
      participants: participants.map((participant) => participant.id),
    });

    const first = await service.settleCompletedSportEvent(event.id);

    expect(first).toEqual({
      sportEventId: event.id,
      contestsSettled: 1,
      contestsCompleted: 1,
      standingsUpserted: 2,
    });
    const statuses = await prisma.contest.findMany({
      where: { id: { in: [directContest.id, invalidContest.id, noRuleContest.id] } },
      select: { id: true, status: true, endsAt: true },
    });
    expect(Object.fromEntries(statuses.map((contest) => [contest.id, contest.status]))).toEqual({
      [directContest.id]: 'COMPLETED',
      [invalidContest.id]: 'ACTIVE',
      [noRuleContest.id]: 'ACTIVE',
    });
    expect(statuses.find((contest) => contest.id === directContest.id)?.endsAt)
      .toEqual(new Date('2026-05-31T22:00:00.000Z'));
    await expect(prisma.contestEntryStanding.count({ where: { contestId: noRuleContest.id } })).resolves.toBe(0);

    const readStandings = async () => (await prisma.contestEntryStanding.findMany({
      where: { contestId: directContest.id },
      orderBy: { position: 'asc' },
      include: { golf: true },
    })).map((standing) => ({
      contestEntryId: standing.contestEntryId,
      totalScoreToPar: standing.golf?.totalScoreToPar,
      position: standing.position,
      displayPosition: standing.displayPosition,
      countingPickLimit: standing.countingPickLimit,
      scoredPickCount: standing.scoredPickCount,
    }));
    const frozen = [
      {
        contestEntryId: directEntries.winner.id,
        totalScoreToPar: -9,
        position: 1,
        displayPosition: '1',
        countingPickLimit: 2,
        scoredPickCount: 3,
      },
      {
        contestEntryId: directEntries.runnerUp.id,
        totalScoreToPar: 1,
        position: 2,
        displayPosition: '2',
        countingPickLimit: 2,
        scoredPickCount: 2,
      },
    ];
    await expect(readStandings()).resolves.toEqual(frozen);

    // #246 — the freeze. A late provider correction (Winner A's -7 becomes +10, which would
    // drop the winner's best-2 total to +1 and tie it with the runner-up) followed by the event
    // being settled again must not rewrite a COMPLETED contest's result.
    await prisma.sportEventParticipantGolfStanding.updateMany({
      where: { standing: { sportEventParticipantId: participants[0].id } },
      data: { eventScoreToPar: 10 },
    });
    const second = await service.settleCompletedSportEvent(event.id);

    expect(second).toEqual({
      sportEventId: event.id,
      contestsSettled: 0,
      contestsCompleted: 0,
      standingsUpserted: 0,
    });
    await expect(readStandings()).resolves.toEqual(frozen);
    // #261 — this asserted one `contest.completed` event across both runs. The outcome it
    // stood for, asserted directly: the contest was not completed a second time.
    await expect(prisma.contest.findUniqueOrThrow({
      where: { id: directContest.id },
      select: { status: true, endsAt: true },
    })).resolves.toEqual({ status: 'COMPLETED', endsAt: new Date('2026-05-31T22:00:00.000Z') });

    // Reopening (OverrideService.reopenContest moves COMPLETED → ACTIVE) is the deliberate
    // path back: the next settlement recomputes the standing from the corrected scores.
    await prisma.contest.update({ where: { id: directContest.id }, data: { status: 'ACTIVE' } });
    const third = await service.settleCompletedSportEvent(event.id);

    expect(third).toEqual({
      sportEventId: event.id,
      contestsSettled: 1,
      contestsCompleted: 1,
      standingsUpserted: 2,
    });
    const resettled = await readStandings();
    expect(resettled.map((standing) => [standing.totalScoreToPar, standing.displayPosition])).toEqual([
      [1, 'T1'],
      [1, 'T1'],
    ]);
    // Still one row per entry: the resettle updated the standings in place (core and extension).
    await expect(prisma.contestEntryGolfStanding.count({
      where: { contestEntryStanding: { contestId: directContest.id } },
    })).resolves.toBe(2);
  });
});

describe('golf contest settlement — which contests settle', () => {
  async function seedCompletedEvent(status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED') {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const sport = await prisma.sport.upsert({
      where: { name: Sport.GOLF },
      create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const league = await prisma.league.create({
      data: { leagueCode: `GSD${suffix.toUpperCase()}`, name: `Golf Settlement Draft League ${suffix}` },
    });
    const event = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `golf-settlement-draft-${suffix}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: `Golf Settlement Draft Open ${suffix}`,
        startDate: new Date('2026-05-28T12:00:00.000Z'),
        endDate: new Date('2026-05-31T22:00:00.000Z'),
        status,
      },
    });
    await createSettlementParticipant({ sportId: sport.id, sportEventId: event.id, name: `Golfer ${suffix}`, scoreToPar: -3, strokes: 285 });
    return { league, event, suffix };
  }

  it('leaves a never-opened DRAFT contest a draft with no standings when its event completes', async () => {
    const prisma = getPrisma();
    const service = createGolfContestSettlementService(prisma);
    const { league, event, suffix } = await seedCompletedEvent();
    const draft = await createSettlementContest({
      leagueId: league.id,
      sportEventId: event.id,
      name: `Never Opened ${suffix}`,
      status: 'DRAFT',
    });
    const active = await createSettlementContest({ leagueId: league.id, sportEventId: event.id, name: `Running ${suffix}` });

    const summary = await service.settleCompletedSportEvent(event.id);

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1 });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: draft.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'DRAFT' });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: active.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'COMPLETED' });
    await expect(prisma.contestEntryStanding.count({ where: { contestId: draft.id } })).resolves.toBe(0);
  });

  it('settles nothing while the event is not yet COMPLETED', async () => {
    const prisma = getPrisma();
    const service = createGolfContestSettlementService(prisma);
    const { league, event, suffix } = await seedCompletedEvent('IN_PROGRESS');
    const active = await createSettlementContest({ leagueId: league.id, sportEventId: event.id, name: `Still Playing ${suffix}` });

    await expect(service.settleCompletedSportEvent(event.id)).resolves.toEqual({
      sportEventId: event.id,
      contestsSettled: 0,
      contestsCompleted: 0,
      standingsUpserted: 0,
    });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: active.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'ACTIVE' });
  });

  it('settles nothing for an event that does not exist', async () => {
    const service = createGolfContestSettlementService(getPrisma());
    const missingId = randomUUID();

    await expect(service.settleCompletedSportEvent(missingId)).resolves.toEqual({
      sportEventId: missingId,
      contestsSettled: 0,
      contestsCompleted: 0,
      standingsUpserted: 0,
    });
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
      isActive: true,
    },
  });
  await prisma.sportEventParticipantStanding.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      currentRound: 4,
      status: 'COMPLETE',
      asOf: new Date('2026-05-31T22:00:00.000Z'),
      golf: {
        create: { eventScoreToPar: input.scoreToPar, eventStrokes: input.strokes, currentRoundThru: 18 },
      },
    },
  });
  return sportEventParticipant;
}

async function createSettlementContest(input: {
  leagueId: string;
  sportEventId: string | null;
  name: string;
  /** Every real configuration carries a scoring rule (#246); false builds one that does not. */
  withScoringRule?: boolean;
  status?: 'DRAFT' | 'OPEN' | 'ACTIVE';
}) {
  const prisma = getPrisma();
  const contest = await prisma.contest.create({
    data: {
      leagueId: input.leagueId,
      sportEventId: input.sportEventId,
      name: input.name,
      status: input.status ?? 'ACTIVE',
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
      ...(input.withScoringRule !== false && {
        participantScoringRules: {
          create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 },
        },
      }),
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

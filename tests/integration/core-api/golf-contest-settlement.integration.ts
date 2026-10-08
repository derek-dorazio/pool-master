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

    // A contest moved back out of COMPLETED is settled again from the corrected scores. No route
    // does that today (the unused reopen endpoint was deleted), so the test moves it directly.
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

describe('golf contest settlement — unplayed rounds score 80 strokes', () => {
  it('freezes +8 for each of rounds 3 and 4 on par-72 rounds for a cut golfer and for one the feed never flagged, and scores no draft entry', async () => {
    const prisma = getPrisma();
    const service = createGolfContestSettlementService(prisma);
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `Golf Unplayed ${suffix}` });
    const sport = await prisma.sport.upsert({
      where: { name: Sport.GOLF },
      create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const league = await prisma.league.create({
      data: { leagueCode: `GSU${suffix.toUpperCase()}`, name: `Golf Unplayed League ${suffix}` },
    });
    const squad = await prisma.squad.create({
      data: { leagueId: league.id, createdBy: owner.user.id, name: `Unplayed ${suffix}` },
    });
    const event = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `golf-settlement-unplayed-${suffix}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: `Golf Unplayed Classic ${suffix}`,
        startDate: new Date('2026-05-28T12:00:00.000Z'),
        endDate: new Date('2026-05-31T22:00:00.000Z'),
        status: 'COMPLETED',
        rounds: 4,
      },
    });
    const eventRounds = await Promise.all([1, 2, 3, 4].map((roundNumber) => prisma.sportEventRound.create({
      data: { sportEventId: event.id, roundNumber, scheduledDate: new Date(Date.UTC(2026, 4, 27 + roundNumber, 12)) },
    })));
    // The leader played all four rounds at 70 on par 72, so every round's par is derivable.
    const leader = await createSettlementParticipant({ sportId: sport.id, sportEventId: event.id, name: `Leader ${suffix}`, scoreToPar: -8, strokes: 280 });
    const cut = await createSettlementParticipant({
      sportId: sport.id, sportEventId: event.id, name: `Cut ${suffix}`, scoreToPar: 2, strokes: 146, status: 'ELIMINATED',
    });
    const writeRound = (sportEventParticipantId: string, roundNumber: number, status: 'COMPLETED' | 'MISSED_CUT', strokes: number) =>
      prisma.sportEventParticipantRound.create({
        data: {
          sportEventParticipantId,
          sportEventRoundId: eventRounds[roundNumber - 1].id,
          status,
          golf: { create: { strokes, scoreToPar: strokes - 72, thru: 18 } },
        },
      });
    for (const roundNumber of [1, 2, 3, 4]) {
      await writeRound(leader.id, roundNumber, 'COMPLETED', 70);
    }
    await writeRound(cut.id, 1, 'COMPLETED', 72);
    await writeRound(cut.id, 2, 'MISSED_CUT', 74);
    // Never flagged as cut by the feed: still COMPLETE, two rounds at par, nothing after.
    const unflagged = await createSettlementParticipant({ sportId: sport.id, sportEventId: event.id, name: `Unflagged ${suffix}`, scoreToPar: 0, strokes: 144 });
    await writeRound(unflagged.id, 1, 'COMPLETED', 72);
    await writeRound(unflagged.id, 2, 'COMPLETED', 72);
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        sportEventId: event.id,
        name: `Unplayed Settlement ${suffix}`,
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
        rosterSize: 2,
        pickCount: 2,
        participantScoringRules: { create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 } },
      },
    });
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: 'Leader and Cut', status: 'SUBMITTED' },
    });
    const unflaggedEntry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 2, name: 'Leader and Unflagged', status: 'SUBMITTED' },
    });
    // Never submitted: a draft is scored nowhere, 80s or not (#481).
    const draftEntry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 3, name: 'Draft Leader and Cut', status: 'DRAFT' },
    });
    await prisma.contestEntryPick.createMany({
      data: [
        { entryId: entry.id, sportEventParticipantId: leader.id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: entry.id, sportEventParticipantId: cut.id, contestFormat: 'ROSTER', slot: 2 },
        { entryId: unflaggedEntry.id, sportEventParticipantId: leader.id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: unflaggedEntry.id, sportEventParticipantId: unflagged.id, contestFormat: 'ROSTER', slot: 2 },
        { entryId: draftEntry.id, sportEventParticipantId: leader.id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: draftEntry.id, sportEventParticipantId: cut.id, contestFormat: 'ROSTER', slot: 2 },
      ],
    });

    await expect(service.settleCompletedSportEvent(event.id)).resolves.toMatchObject({ contestsSettled: 1, standingsUpserted: 2 });

    // -8 for the leader; +2 played plus +8 for each of rounds 3 and 4 for the cut golfer.
    const standing = await prisma.contestEntryStanding.findFirstOrThrow({
      where: { contestEntryId: entry.id },
      include: { golf: true },
    });
    expect(standing.golf?.totalScoreToPar).toBe(10);
    expect(standing.scoredPickCount).toBe(2);
    // A golfer still marked in the event when it completes, missing rounds 3 and 4, gets their
    // 80s too: -8 for the leader, E plus +16 for them.
    const unflaggedStanding = await prisma.contestEntryStanding.findFirstOrThrow({
      where: { contestEntryId: unflaggedEntry.id },
      include: { golf: true },
    });
    expect(unflaggedStanding.golf?.totalScoreToPar).toBe(8);
    await expect(prisma.contestEntryStanding.findFirst({ where: { contestEntryId: draftEntry.id } })).resolves.toBeNull();
  });
});

async function createSettlementParticipant(input: {
  sportId: string;
  sportEventId: string;
  name: string;
  scoreToPar: number;
  strokes: number;
  status?: 'COMPLETE' | 'ELIMINATED' | 'WITHDRAWN';
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
      status: input.status ?? 'COMPLETE',
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
        status: 'SUBMITTED',
      },
    }),
    prisma.contestEntry.create({
      data: {
        contestId: input.contestId,
        squadId: input.squadTwoId,
        entryNumber: 2,
        name: 'Runner Up',
        status: 'SUBMITTED',
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

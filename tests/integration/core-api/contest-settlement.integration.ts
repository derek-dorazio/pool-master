import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Sport, type Contest } from '@poolmaster/shared/domain';
import { createContestService, createContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { fakeLogger } from '../../support/fake-logger';
import type { ContestFinalStandings } from '../../../packages/core-api/src/modules/contests/service';
import { integrationPlanEntitlements } from '../plan-entitlements';

beforeAll(() => setupIntegrationTests());
afterEach(() => cleanupTestData());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('pool-master-eux.6: schedule-driven Golf contest settlement', () => {
  it('pool-master-eux.6: freezes final standings, completes the sport event\'s contests, tells the league its final places once per completion, and is idempotent', async () => {
    const prisma = getPrisma();
    const contests = createContestService(getAppPrisma(), fakeLogger(), { planEntitlements: integrationPlanEntitlements() });
    // What the final results email reads, read when settlement tells it the contest completed.
    const told: Array<{ contestId: string; final: ContestFinalStandings }> = [];
    const service = createContestSettlementService(getAppPrisma(), undefined, {
      contestSettled: { contestSettled: async (contest: Contest) => { told.push({ contestId: contest.id, final: await contests.finalStandingsOf(contest) }); } },
    });
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `Golf Settlement ${suffix}` });
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: {
        sport: Sport.GOLF,
        participantType: 'INDIVIDUAL',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });
    const league = await prisma.league.create({
      data: {
        cupName: 'Test Cup', leagueCode: `GST${suffix.toUpperCase()}`,
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
          seasonYear: 2026,
          sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
          name: `Invalid Settlement ${suffix}`,
          status: 'ACTIVE',
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
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
      sportEventId: event.id,
      squadOneId: squadOne.id,
      squadTwoId: squadTwo.id,
      participants: participants.map((participant) => participant.id),
    });

    const first = await service.settleFinishedSportEvent(event.id);

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
    expect(told).toEqual([{
      contestId: directContest.id,
      final: {
        scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        entries: [
          { entryId: directEntries.winner.id, entryName: 'Winner', squadId: squadOne.id, squadName: squadOne.name, position: 1, displayPosition: '1', score: -9 },
          { entryId: directEntries.runnerUp.id, entryName: 'Runner Up', squadId: squadTwo.id, squadName: squadTwo.name, position: 2, displayPosition: '2', score: 1 },
        ],
      },
    }]);

    const readStandings = async () => (await prisma.contestEntryStanding.findMany({
      where: { contestId: directContest.id },
      orderBy: { position: 'asc' },
    })).map((standing) => ({
      contestEntryId: standing.contestEntryId,
      totalScore: standing.totalScore,
      position: standing.position,
      displayPosition: standing.displayPosition,
      countingPickLimit: standing.countingPickLimit,
      scoredPickCount: standing.scoredPickCount,
    }));
    const frozen = [
      {
        contestEntryId: directEntries.winner.id,
        totalScore: -9,
        position: 1,
        displayPosition: '1',
        countingPickLimit: 2,
        scoredPickCount: 3,
      },
      {
        contestEntryId: directEntries.runnerUp.id,
        totalScore: 1,
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
    const second = await service.settleFinishedSportEvent(event.id);

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
    expect(told).toHaveLength(1);

    // The event's own standings froze at the first settlement too (#713).
    await expect(prisma.contestEntryEventStanding.count({ where: { contestId: directContest.id, sportEventId: event.id } }))
      .resolves.toBe(2);

    // A contest moved back out of COMPLETED is completed again, its total re-summed from its
    // events' frozen standings (#713): the late correction does not reach an event that already
    // settled. No route does that today (the unused reopen endpoint was deleted), so the test
    // moves it directly.
    await prisma.contest.update({ where: { id: directContest.id }, data: { status: 'ACTIVE' } });
    const third = await service.settleFinishedSportEvent(event.id);

    expect(third).toEqual({
      sportEventId: event.id,
      contestsSettled: 1,
      contestsCompleted: 1,
      standingsUpserted: 2,
    });
    const resettled = await readStandings();
    expect(resettled.map((standing) => [standing.totalScore, standing.displayPosition])).toEqual([
      [-9, '1'],
      [1, '2'],
    ]);
    expect(told.map((notice) => notice.contestId)).toEqual([directContest.id, directContest.id]);
    // Still one row per entry: the resettle updated the standings in place.
    await expect(prisma.contestEntryStanding.count({ where: { contestId: directContest.id } })).resolves.toBe(2);
  });
});

describe('golf contest settlement — which contests settle', () => {
  async function seedCompletedEvent(status: 'COMPLETED' | 'IN_PROGRESS' = 'COMPLETED') {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const league = await prisma.league.create({
      data: { cupName: 'Test Cup', leagueCode: `GSD${suffix.toUpperCase()}`, name: `Golf Settlement Draft League ${suffix}` },
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
    const service = createContestSettlementService(getAppPrisma());
    const { league, event, suffix } = await seedCompletedEvent();
    const draft = await createSettlementContest({
      leagueId: league.id,
      sportEventId: event.id,
      name: `Never Opened ${suffix}`,
      status: 'DRAFT',
    });
    const active = await createSettlementContest({ leagueId: league.id, sportEventId: event.id, name: `Running ${suffix}` });

    const summary = await service.settleFinishedSportEvent(event.id);

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1 });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: draft.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'DRAFT' });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: active.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'COMPLETED' });
    await expect(prisma.contestEntryStanding.count({ where: { contestId: draft.id } })).resolves.toBe(0);
  });

  it('scores each contest under its own scoring settings: one whose settings are not a settings object stays unsettled, while one beside it with retired keys settles', async () => {
    const prisma = getPrisma();
    const service = createContestSettlementService(getAppPrisma());
    const { league, event, suffix } = await seedCompletedEvent();
    const invalidSettings = await createSettlementContest({
      leagueId: league.id,
      sportEventId: event.id,
      name: `Invalid Settings ${suffix}`,
      scoringRuleConfig: ['points'],
    });
    const retiredKeys = await createSettlementContest({
      leagueId: league.id,
      sportEventId: event.id,
      name: `Retired Keys ${suffix}`,
      scoringRuleConfig: { cutRule: { type: 'FIXED_SCORE', fixedScore: 80 }, playoffHandling: 'EXCLUDE_PLAYOFF_HOLES' },
    });

    const summary = await service.settleFinishedSportEvent(event.id);

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1 });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: invalidSettings.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'ACTIVE' });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: retiredKeys.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'COMPLETED' });
    await expect(prisma.contestEntryStanding.count({ where: { contestId: invalidSettings.id } })).resolves.toBe(0);
  });

  it('still completes a contest whose final results email cannot be queued, and logs the failure', async () => {
    const prisma = getPrisma();
    const logger = fakeLogger();
    const service = createContestSettlementService(getAppPrisma(), logger, {
      contestSettled: { contestSettled: async () => Promise.reject(new Error('outbox unavailable')) },
    });
    const { league, event, suffix } = await seedCompletedEvent();
    const active = await createSettlementContest({ leagueId: league.id, sportEventId: event.id, name: `Mail Down ${suffix}` });

    const summary = await service.settleFinishedSportEvent(event.id);

    expect(summary).toMatchObject({ contestsSettled: 1, contestsCompleted: 1 });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: active.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'COMPLETED' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ contestId: active.id, error: 'outbox unavailable' }),
      'Failed to queue final results emails',
    );
  });

  it('settles nothing while the event is not yet COMPLETED', async () => {
    const prisma = getPrisma();
    const service = createContestSettlementService(getAppPrisma());
    const { league, event, suffix } = await seedCompletedEvent('IN_PROGRESS');
    const active = await createSettlementContest({ leagueId: league.id, sportEventId: event.id, name: `Still Playing ${suffix}` });

    await expect(service.settleFinishedSportEvent(event.id)).resolves.toEqual({
      sportEventId: event.id,
      contestsSettled: 0,
      contestsCompleted: 0,
      standingsUpserted: 0,
    });
    await expect(prisma.contest.findUniqueOrThrow({ where: { id: active.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'ACTIVE' });
  });

  it('settles nothing for an event that does not exist', async () => {
    const service = createContestSettlementService(getAppPrisma());
    const missingId = randomUUID();

    await expect(service.settleFinishedSportEvent(missingId)).resolves.toEqual({
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
    const service = createContestSettlementService(getAppPrisma());
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `Golf Unplayed ${suffix}` });
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const league = await prisma.league.create({
      data: { cupName: 'Test Cup', leagueCode: `GSU${suffix.toUpperCase()}`, name: `Golf Unplayed League ${suffix}` },
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
        seasonYear: 2026,
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        name: `Unplayed Settlement ${suffix}`,
        status: 'ACTIVE',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
      },
    });
    await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'TIERED',
        configJson: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 2 },
        participantScoringRules: { create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 } },
      },
    });
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: 'Leader and Cut', events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } } },
    });
    const unflaggedEntry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 2, name: 'Leader and Unflagged', events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } } },
    });
    // Never submitted: a draft is scored nowhere, 80s or not (#481).
    const draftEntry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squad.id, entryNumber: 3, name: 'Draft Leader and Cut', events: { create: { sportEventId: event.id, status: 'DRAFT' } } },
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

    await expect(service.settleFinishedSportEvent(event.id)).resolves.toMatchObject({ contestsSettled: 1, standingsUpserted: 2 });

    // -8 for the leader; +2 played plus +8 for each of rounds 3 and 4 for the cut golfer.
    const standing = await prisma.contestEntryStanding.findFirstOrThrow({
      where: { contestEntryId: entry.id },
    });
    expect(standing.totalScore).toBe(10);
    expect(standing.scoredPickCount).toBe(2);
    // A golfer still marked in the event when it completes, missing rounds 3 and 4, gets their
    // 80s too: -8 for the leader, E plus +16 for them.
    const unflaggedStanding = await prisma.contestEntryStanding.findFirstOrThrow({
      where: { contestEntryId: unflaggedEntry.id },
    });
    expect(unflaggedStanding.totalScore).toBe(8);
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
  sportEventId: string;
  name: string;
  /** Every real configuration carries a scoring rule (#246); false builds one that does not. */
  withScoringRule?: boolean;
  /** The rule's stored `config` column; the column's default (`{}`) when omitted. */
  scoringRuleConfig?: Prisma.InputJsonValue;
  status?: 'DRAFT' | 'OPEN' | 'ACTIVE';
}) {
  const prisma = getPrisma();
  const contest = await prisma.contest.create({
    data: {
      leagueId: input.leagueId,
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: input.sportEventId, sequence: 1 } },
      name: input.name,
      status: input.status ?? 'ACTIVE',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: 'TIERED',
      configJson: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 2 },
      ...(input.withScoringRule !== false && {
        participantScoringRules: {
          create: {
            participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
            sortOrder: 1,
            ...(input.scoringRuleConfig !== undefined && { config: input.scoringRuleConfig }),
          },
        },
      }),
    },
  });
  return contest;
}

async function createSettlementEntries(input: {
  contestId: string;
  sportEventId: string;
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
        events: { create: { sportEventId: input.sportEventId, status: 'SUBMITTED', submittedAt: new Date() } },
      },
    }),
    prisma.contestEntry.create({
      data: {
        contestId: input.contestId,
        squadId: input.squadTwoId,
        entryNumber: 2,
        name: 'Runner Up',
        events: { create: { sportEventId: input.sportEventId, status: 'SUBMITTED', submittedAt: new Date() } },
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

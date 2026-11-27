import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { writeGolfRounds } from '../golf-rounds';
import { ContestLeaderboardResponseSchema, type ErrorEnvelope } from '@poolmaster/shared/dto';
import { PARTICIPANT_SCORING_DEFINITIONS, Sport } from '@poolmaster/shared/domain';
import { freshEventEdition } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';
import { forgetStoredLeaderboards, passReadCacheTtl, restoreReadCacheClock } from '../../support/read-cache-clock';
import { participantLeagueId } from '../../support/participant-league';
import { sportRowKeys } from '../../support/sport-rows';
import { oneEventSlotId } from '../../support/test-slots';
import { contestOnEvents, contestTemplateId } from '../../support/contest-rows';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
afterEach(() => restoreReadCacheClock());

describe('pool-master-eux.4: Golf leaderboard read API', () => {
  it('returns a Golf leaderboard ranked from event standings with counting and dropped picks', async () => {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ displayName: `Golf Leaderboard ${suffix}` });
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: {
        sport: Sport.GOLF,
        ...sportRowKeys(Sport.GOLF),
      },
      update: {},
    });
    const league = await prisma.league.create({
      data: {
        cupName: 'Test Cup', leagueCode: `GLB${suffix.toUpperCase()}`,
        name: `Golf Leaderboard League ${suffix}`,
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
        ...(await freshEventEdition(prisma)),
        name: `Golf Leaderboard Invitational ${suffix}`,
        startDate: new Date('2026-05-28T12:00:00.000Z'),
        endDate: new Date('2026-05-31T22:00:00.000Z'),
        status: 'IN_PROGRESS',
      },
    });
    // The rounds belong to the event, not to any one participant, so they are
    // created once here rather than inside createGolfLeaderboardParticipant.
    // That helper runs four times concurrently in the Promise.all below, and
    // Prisma's upsert is a read-then-write, not an atomic INSERT ... ON CONFLICT:
    // two racing callers both saw "does not exist", both INSERTed, and the loser
    // failed on sport_event_rounds_sport_event_id_round_number_key. See #142.
    // `create` rather than `upsert` on purpose -- the event was just created with
    // a unique suffix, so a pre-existing round is a broken assumption worth failing on.
    await Promise.all([
      prisma.sportEventRound.create({
        data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 1, scheduledDate: new Date('2026-04-09T12:00:00.000Z') },
      }),
      prisma.sportEventRound.create({
        data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber: 2, scheduledDate: new Date('2026-04-10T12:00:00.000Z') },
      }),
    ]);
    // One golfer at a time: each one's sides join the rounds' FIELD Games in turn.
    const participants: Awaited<ReturnType<typeof createGolfLeaderboardParticipant>>[] = [];
    for (const golfer of [
      {
        sportId: sport.id,
        sportEventId: event.id,
        name: `Rory ${suffix}`,
        scoreToPar: -5,
        strokes: 139,
        status: 'IN_PROGRESS',
        thru: 9,
      },
      {
        sportId: sport.id,
        sportEventId: event.id,
        name: `Scottie ${suffix}`,
        scoreToPar: -2,
        strokes: 142,
        status: 'COMPLETE',
      },
      {
        sportId: sport.id,
        sportEventId: event.id,
        name: `Jordan ${suffix}`,
        scoreToPar: 1,
        strokes: 145,
        status: 'COMPLETE',
      },
      {
        sportId: sport.id,
        sportEventId: event.id,
        name: `Ludvig ${suffix}`,
        scoreToPar: -7,
        strokes: 137,
        status: 'COMPLETE',
      },
    ] as const) {
      participants.push(await createGolfLeaderboardParticipant(golfer));
    }
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        ...(await contestOnEvents(prisma, [event.id])),
        name: `Golf Leaderboard Contest ${suffix}`,
        status: 'ACTIVE',
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
      },
    });
    await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        templateId: await contestTemplateId(prisma, contest.id),
        selectionType: 'TIERED',
        configJson: {
          selectionType: 'TIERED',
          picksPerTier: 1,
          countedScores: 2,
        },
        // Every configuration carries its scoring rule (#246); there is no golf fallback.
        participantScoringRules: {
          create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 },
        },
      },
    });
    const [entryOne, entryTwo] = await Promise.all([
      prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          squadId: squadOne.id,
          entryNumber: 1,
          name: `Standing Runner-Up ${suffix}`,
          events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } },
        },
      }),
      prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          squadId: squadTwo.id,
          entryNumber: 1,
          name: `Standing Winner ${suffix}`,
          events: { create: { sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date() } },
        },
      }),
    ]);
    await Promise.all([
      createGolfLeaderboardPick(entryOne.id, participants[0].id),
      createGolfLeaderboardPick(entryOne.id, participants[1].id),
      createGolfLeaderboardPick(entryOne.id, participants[2].id),
      createGolfLeaderboardPick(entryTwo.id, participants[3].id),
      createGolfLeaderboardPick(entryTwo.id, participants[1].id),
      createGolfLeaderboardPick(entryTwo.id, participants[2].id),
    ]);

    const response = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contest.id}/leaderboard`,
      headers: owner.headers,
    });

    expect(response.statusCode).toBe(200);
    const parsed = ContestLeaderboardResponseSchema.parse(response.json());
    expect(parsed.scoringDefinitionId).toBe('GOLF_RELATIVE_TO_PAR_TOTAL');
    expect(parsed.sport).toBe(Sport.GOLF);
    expect(parsed.entries.map((entry) => [entry.entryId, entry.totalScore, entry.position])).toEqual([
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
    // The field is published as the event's own rows (#248): the standing and each round carry
    // their golf extension, and the client renders a round through the named definition.
    const rory = parsed.participants.find((participant) => participant.id === participants[0].id);
    expect(rory?.standing).toEqual(expect.objectContaining({
      status: 'IN_PROGRESS',
      golf: expect.objectContaining({ eventScoreToPar: -5, currentRoundThru: 9 }),
    }));
    const roundTwo = rory?.rounds.find((round) => round.roundNumber === 2);
    expect(roundTwo?.golf).toEqual(expect.objectContaining({ scoreToPar: -2, thru: 9 }));
    expect(expectDefined(PARTICIPANT_SCORING_DEFINITIONS[parsed.scoringDefinitionId].formatRound)({
      status: expectDefined(roundTwo).status,
      strokes: expectDefined(expectDefined(roundTwo).golf).strokes,
      scoreToPar: expectDefined(expectDefined(roundTwo).golf).scoreToPar,
    })).toBe('-2');

    // #246 — once the contest is COMPLETED the leaderboard answers from the frozen standings,
    // not from live scores. The settled result below deliberately disagrees with the live one
    // (entry one won at -11 under a best-3 rule) so the test proves which one was read.
    const settledAt = new Date('2026-05-31T22:00:00.000Z');
    await prisma.contest.update({ where: { id: contest.id }, data: { status: 'COMPLETED' } });
    for (const [entryId, totalScore, position] of [[entryOne.id, -11, 1], [entryTwo.id, -4, 2]] as const) {
      await prisma.contestEntryStanding.create({
        data: {
          contestId: contest.id,
          contestEntryId: entryId,
          position,
          displayPosition: String(position),
          countingPickLimit: 3,
          scoredPickCount: 3,
          asOf: settledAt,
          settledAt,
          totalScore,
        },
      });
      // Settlement freezes the event's own standing alongside the contest total (#713).
      await prisma.contestEntryEventStanding.create({
        data: {
          contestId: contest.id,
          contestEntryId: entryId,
          sportEventId: event.id,
          position,
          displayPosition: String(position),
          countingPickLimit: 3,
          scoredPickCount: 3,
          asOf: settledAt,
          settledAt,
          totalScore,
        },
      });
    }
    // The next viewer poll, after standings the test froze without a write that tells (#1435).
    passReadCacheTtl();
    await forgetStoredLeaderboards(prisma);
    const settledResponse = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contest.id}/leaderboard`,
      headers: owner.headers,
    });
    expect(settledResponse.statusCode).toBe(200);
    const settled = ContestLeaderboardResponseSchema.parse(settledResponse.json());
    expect(settled.entries.map((entry) => [entry.entryId, entry.totalScore, entry.position])).toEqual([
      [entryOne.id, -11, 1],
      [entryTwo.id, -4, 2],
    ]);
    expect(settled.entries[0].countingPickLimit).toBe(3);
    expect(settled.countingRule.count).toBe(3);
    expect(settled.asOf).toBe(settledAt.toISOString());

    // #246 — no fallback: a configuration without a scoring rule is refused with its own code.
    await prisma.participantContestScoringRule.deleteMany({
      where: { contestConfiguration: { contestId: contest.id } },
    });
    passReadCacheTtl();
    await forgetStoredLeaderboards(prisma);
    const noRuleResponse = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contest.id}/leaderboard`,
      headers: owner.headers,
    });
    expect(noRuleResponse.statusCode).toBe(400);
    expect(noRuleResponse.json<ErrorEnvelope>().error.code).toBe('CONTEST_LEADERBOARD_SCORING_RULE_MISSING');
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
      sportLeagueId: await participantLeagueId(prisma, input.sportId),
      name: input.name,
      participantType: 'INDIVIDUAL',
      status: 'ACTIVE',
    },
  });
  const sportEventParticipant = await prisma.sportEventParticipant.create({
    data: {
      sportEventId: input.sportEventId,
      participantId: participant.id,
    },
  });
  const playing = input.status === 'IN_PROGRESS';
  await writeGolfRounds(prisma, input.sportEventId, [
    { roundNumber: 1, scores: [{ sportEventParticipantId: sportEventParticipant.id, strokes: input.strokes - 47, scoreToPar: input.scoreToPar + 2 }] },
    {
      roundNumber: 2,
      scores: [{ sportEventParticipantId: sportEventParticipant.id, strokes: 47, scoreToPar: -2, ...(playing ? { status: null, thru: input.thru ?? null } : {}) }],
    },
  ]);
  await prisma.sportEventParticipantStanding.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      status: input.status,
      asOf: new Date('2026-05-31T18:00:00.000Z'),
      scoreToPar: input.scoreToPar,
      total: input.strokes,
    },
  });
  return sportEventParticipant;
}

async function createGolfLeaderboardPick(entryId: string, sportEventParticipantId: string) {
  return getPrisma().contestEntryPick.create({
    data: { entryId, sportEventParticipantId },
  });
}

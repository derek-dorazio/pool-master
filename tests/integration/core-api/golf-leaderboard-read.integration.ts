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
import { ContestLeaderboardResponseSchema, type ErrorEnvelope } from '@poolmaster/shared/dto';
import { PARTICIPANT_SCORING_DEFINITIONS, Sport } from '@poolmaster/shared/domain';
import { freshEventEdition } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';

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
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });
    const league = await prisma.league.create({
      data: {
        leagueCode: `GLB${suffix.toUpperCase()}`,
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
        externalId: `golf-leaderboard-event-${suffix}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
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
    const [round1, round2] = await Promise.all([
      prisma.sportEventRound.create({
        data: { sportEventId: event.id, roundNumber: 1, scheduledDate: new Date('2026-04-09T12:00:00.000Z') },
      }),
      prisma.sportEventRound.create({
        data: { sportEventId: event.id, roundNumber: 2, scheduledDate: new Date('2026-04-10T12:00:00.000Z') },
      }),
    ]);
    const participants = await Promise.all([
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        round1Id: round1.id,
        round2Id: round2.id,
        name: `Rory ${suffix}`,
        scoreToPar: -5,
        strokes: 139,
        status: 'IN_PROGRESS',
        thru: 9,
      }),
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        round1Id: round1.id,
        round2Id: round2.id,
        name: `Scottie ${suffix}`,
        scoreToPar: -2,
        strokes: 142,
        status: 'COMPLETE',
      }),
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        round1Id: round1.id,
        round2Id: round2.id,
        name: `Jordan ${suffix}`,
        scoreToPar: 1,
        strokes: 145,
        status: 'COMPLETE',
      }),
      createGolfLeaderboardParticipant({
        sportId: sport.id,
        sportEventId: event.id,
        round1Id: round1.id,
        round2Id: round2.id,
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
          status: 'SUBMITTED',
        },
      }),
      prisma.contestEntry.create({
        data: {
          contestId: contest.id,
          squadId: squadTwo.id,
          entryNumber: 1,
          name: `Standing Winner ${suffix}`,
          status: 'SUBMITTED',
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
    const parsed = ContestLeaderboardResponseSchema.parse(response.json());
    expect(parsed.scoringDefinitionId).toBe('GOLF_RELATIVE_TO_PAR_TOTAL');
    expect(parsed.entries.map((entry) => [entry.entryId, entry.golf?.totalScoreToPar, entry.position])).toEqual([
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
    expect(PARTICIPANT_SCORING_DEFINITIONS[parsed.scoringDefinitionId].formatRound({
      status: expectDefined(roundTwo).status,
      strokes: expectDefined(expectDefined(roundTwo).golf).strokes,
      scoreToPar: expectDefined(expectDefined(roundTwo).golf).scoreToPar,
    })).toBe('-2');

    // #246 — once the contest is COMPLETED the leaderboard answers from the frozen standings,
    // not from live scores. The settled result below deliberately disagrees with the live one
    // (entry one won at -11 under a best-3 rule) so the test proves which one was read.
    const settledAt = new Date('2026-05-31T22:00:00.000Z');
    await prisma.contest.update({ where: { id: contest.id }, data: { status: 'COMPLETED' } });
    for (const [entryId, totalScoreToPar, position] of [[entryOne.id, -11, 1], [entryTwo.id, -4, 2]] as const) {
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
          golf: { create: { totalScoreToPar } },
        },
      });
    }
    const settledResponse = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contest.id}/golf/leaderboard`,
      headers: owner.headers,
    });
    expect(settledResponse.statusCode).toBe(200);
    const settled = ContestLeaderboardResponseSchema.parse(settledResponse.json());
    expect(settled.entries.map((entry) => [entry.entryId, entry.golf?.totalScoreToPar, entry.position])).toEqual([
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
    const noRuleResponse = await getApp().inject({
      method: 'GET',
      url: `/api/v1/contests/${contest.id}/golf/leaderboard`,
      headers: owner.headers,
    });
    expect(noRuleResponse.statusCode).toBe(400);
    expect(noRuleResponse.json<ErrorEnvelope>().error.code).toBe('CONTEST_GOLF_LEADERBOARD_SCORING_RULE_MISSING');
  });
});

async function createGolfLeaderboardParticipant(input: {
  sportId: string;
  sportEventId: string;
  round1Id: string;
  round2Id: string;
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
  await prisma.sportEventParticipantRound.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      sportEventRoundId: input.round1Id,
      status: 'COMPLETED',
      golf: { create: { strokes: input.strokes - 47, scoreToPar: input.scoreToPar + 2 } },
    },
  });
  await prisma.sportEventParticipantRound.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      sportEventRoundId: input.round2Id,
      status: input.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'COMPLETED',
      golf: {
        create: {
          strokes: 47,
          scoreToPar: -2,
          thru: input.status === 'IN_PROGRESS' ? input.thru ?? null : null,
        },
      },
    },
  });
  await prisma.sportEventParticipantStanding.create({
    data: {
      sportEventParticipantId: sportEventParticipant.id,
      currentRound: 2,
      status: input.status,
      asOf: new Date('2026-05-31T18:00:00.000Z'),
      golf: {
        create: {
          eventScoreToPar: input.scoreToPar,
          eventStrokes: input.strokes,
          currentRoundThru: input.status === 'IN_PROGRESS' ? input.thru ?? null : 18,
        },
      },
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

import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ContestStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaContestRepository } from '../../../packages/core-api/src/adapters';
import { createContestService } from '../../../packages/core-api/src/modules/contests/wiring';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { countingPrisma } from '../../support/counting-prisma';
import { integrationPlanEntitlements } from '../plan-entitlements';
import { freshEventEdition } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';

// The roster contest leaderboard's reads against real Postgres (#1162): however many events the
// contest has, its entries come from one query and its picks from one more, and only the picks
// of the events scored live: the shown one and any not settled yet. A settled event answers
// from its frozen standings, without its picks. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const DAY = 24 * 60 * 60 * 1000;
const ENTRIES = 3;
const PICKS_PER_EVENT = 4;

/**
 * A golf event that started `daysAgo`, with a field of `PICKS_PER_EVENT` golfers. With
 * `scoresToPar`, golfer N has finished two rounds at the Nth score to par.
 */
async function createEvent(label: string, daysAgo: number, status: SportEventStatus, scoresToPar?: readonly number[]) {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `leaderboard-reads-${randomUUID()}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `${label} ${randomUUID().slice(0, 6)}`,
      startDate: new Date(Date.now() - daysAgo * DAY),
      endDate: new Date(Date.now() - daysAgo * DAY + 3 * DAY),
      status,
    },
  });
  const rounds = scoresToPar && await Promise.all([1, 2].map((roundNumber) => prisma.sportEventRound.create({
    data: { sportEventId: event.id, roundNumber, scheduledDate: new Date(event.startDate.getTime() + (roundNumber - 1) * DAY) },
  })));
  const field = [];
  for (let golfer = 1; golfer <= PICKS_PER_EVENT; golfer++) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `Golfer ${golfer} ${randomUUID().slice(0, 6)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    const row = await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, isActive: true } });
    const scoreToPar = scoresToPar?.[golfer - 1];
    if (rounds && scoreToPar !== undefined) {
      for (const [index, round] of rounds.entries()) {
        await prisma.sportEventParticipantRound.create({
          data: {
            sportEventParticipantId: row.id,
            sportEventRoundId: round.id,
            status: 'COMPLETED',
            // The first round carries the event's score to par, the second is level.
            golf: { create: { strokes: index === 0 ? 72 + scoreToPar : 72, scoreToPar: index === 0 ? scoreToPar : 0 } },
          },
        });
      }
      await prisma.sportEventParticipantStanding.create({
        data: {
          sportEventParticipantId: row.id,
          currentRound: 2,
          status: 'COMPLETE',
          asOf: new Date(),
          golf: { create: { eventScoreToPar: scoreToPar, eventStrokes: 144 + scoreToPar, currentRoundThru: 18 } },
        },
      });
    }
    field.push(row);
  }
  return { event, field };
}

/**
 * A four-major contest of `status` whose viewer is its commissioner, with three entries that
 * each submitted every major and picked its whole field. Every major but the last finished and
 * settled, its standings frozen; the last is under way unless `lastSettled`.
 */
async function fourMajors(status: ContestStatus, lastSettled: boolean) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const majors = [
    await createEvent('Masters', 200, SportEventStatus.COMPLETED),
    await createEvent('PGA', 160, SportEventStatus.COMPLETED),
    await createEvent('US Open', 120, SportEventStatus.COMPLETED),
    await createEvent('Open', 1, lastSettled ? SportEventStatus.COMPLETED : SportEventStatus.IN_PROGRESS),
  ];
  const owner = await createTestUser({ displayName: `Leaderboard Reads ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `LBR${suffix.toUpperCase()}`, name: `Leaderboard Reads League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: majors.map(({ event }, index) => ({ sportEventId: event.id, sequence: index + 1 })) },
      name: `Majors ${suffix}`,
      status,
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
  const settledAt = new Date();
  const settledMajors = lastSettled ? majors : majors.slice(0, -1);
  const entries = [];
  for (let number = 1; number <= ENTRIES; number++) {
    const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Squad ${number} ${suffix}` } });
    const entry = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        squadId: squad.id,
        entryNumber: 1,
        name: `Entry ${number}`,
        events: { create: majors.map(({ event }) => ({ sportEventId: event.id, status: 'SUBMITTED', submittedAt: new Date(event.startDate.getTime() - DAY) })) },
      },
    });
    entries.push(entry);
    await prisma.contestEntryPick.createMany({
      data: majors.flatMap(({ field }) => field.map((row, index) => ({
        entryId: entry.id,
        sportEventParticipantId: row.id,
        contestFormat: 'ROSTER' as const,
        slot: index + 1,
        pickedAt: new Date(),
      }))),
    });
    // Entry 1 settles first in every major, entry 3 last.
    for (const { event } of settledMajors) {
      await prisma.contestEntryEventStanding.create({
        data: {
          contestId: contest.id,
          contestEntryId: entry.id,
          sportEventId: event.id,
          position: number,
          displayPosition: String(number),
          countingPickLimit: 2,
          scoredPickCount: 2,
          asOf: settledAt,
          settledAt,
          totalScore: number - 4,
        },
      });
    }
    if (status === ContestStatus.COMPLETED) {
      await prisma.contestEntryStanding.create({
        data: {
          contestId: contest.id,
          contestEntryId: entry.id,
          position: number,
          displayPosition: String(number),
          countingPickLimit: 2,
          scoredPickCount: 8,
          asOf: settledAt,
          settledAt,
          totalScore: 4 * (number - 4),
        },
      });
    }
  }
  return { contest, entries, majors, viewerId: owner.user.id };
}

/** A league whose commissioner is the viewer, and a golf contest over `events`, ACTIVE, counting each entry's best two. */
async function golfContest(events: ReadonlyArray<{ event: { id: string } }>) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ displayName: `Leaderboard Reads ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `LBR${suffix.toUpperCase()}`, name: `Leaderboard Reads League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: events.map(({ event }, index) => ({ sportEventId: event.id, sequence: index + 1 })) },
      name: `Season ${suffix}`,
      status: ContestStatus.ACTIVE,
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
  /** An entry named `name` that submitted each event in `picks`, picking those field rows there. */
  const addEntry = async (name: string, picks: ReadonlyArray<{ eventId: string; fieldRowIds: readonly string[] }>) => {
    const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `${name} Squad ${suffix}` } });
    const entry = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        squadId: squad.id,
        entryNumber: 1,
        name,
        events: { create: picks.map(({ eventId }) => ({ sportEventId: eventId, status: 'SUBMITTED', submittedAt: new Date() })) },
      },
    });
    await prisma.contestEntryPick.createMany({
      data: picks.flatMap(({ fieldRowIds }) => fieldRowIds.map((sportEventParticipantId, index) => ({
        entryId: entry.id, sportEventParticipantId, contestFormat: 'ROSTER' as const, slot: index + 1, pickedAt: new Date(),
      }))),
    });
    return entry;
  };
  /** The entry's frozen standing in a settled event. */
  const freeze = (contestEntryId: string, sportEventId: string, position: number, totalScore: number) => prisma.contestEntryEventStanding.create({
    data: {
      contestId: contest.id, contestEntryId, sportEventId, position, displayPosition: String(position),
      countingPickLimit: 2, scoredPickCount: 2, asOf: new Date(), settledAt: new Date(), totalScore,
    },
  });
  return { contest, viewerId: owner.user.id, addEntry, freeze };
}

/** Every query against the field and the picks that names `sportEventId`, as `Model.operation`. */
function fieldAndPickReadsOf(sportEventId: string) {
  const reads: string[] = [];
  const client = getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if ((model.startsWith('SportEventParticipant') || model === 'ContestEntryPick') && JSON.stringify(args).includes(sportEventId)) {
            reads.push(`${model}.${operation}`);
          }
          return query(args);
        },
      },
    },
  });
  return { prisma: client as unknown as PrismaClient, reads };
}

function serviceOn(prisma: PrismaClient) {
  return createContestService(prisma, getApp().log, { planEntitlements: integrationPlanEntitlements(prisma) });
}

describe('ContestService.getLeaderboard reads (#1162)', () => {
  it('reads the entries once and only the major under way\'s picks, not every pick once per major', async () => {
    const season = await fourMajors(ContestStatus.ACTIVE, false);
    const { prisma, count, rows } = countingPrisma(getPrisma());

    const leaderboard = await serviceOn(prisma).getLeaderboard(season.contest.id, season.viewerId);

    expect(count('ContestEntry.findMany')).toBe(1);
    expect(count('ContestEntryPick.findMany')).toBe(1);
    expect(rows('ContestEntryPick.findMany')).toBe(ENTRIES * PICKS_PER_EVENT);
    // The settled majors answer from their frozen standings; the live one lists every entry unscored.
    const first = leaderboard.entries.find((entry) => entry.entryId === season.entries[0]?.id);
    expect(first?.events.map((event) => [event.sportEventId, event.position, event.score])).toEqual([
      [season.majors[0]?.event.id, 1, -3],
      [season.majors[1]?.event.id, 1, -3],
      [season.majors[2]?.event.id, 1, -3],
      [season.majors[3]?.event.id, null, null],
    ]);
    expect(leaderboard.entries.map((entry) => [entry.entryName, entry.score, entry.position])).toEqual([
      ['Entry 1', -9, 1],
      ['Entry 2', -6, 2],
      ['Entry 3', -3, 3],
    ]);
    expect(first?.picks).toHaveLength(PICKS_PER_EVENT);
  });

  it('answers a COMPLETED contest from its frozen totals, reading the picks of the shown major alone', async () => {
    const season = await fourMajors(ContestStatus.COMPLETED, true);
    const { prisma, count, rows } = countingPrisma(getPrisma());

    const leaderboard = await serviceOn(prisma).getLeaderboard(season.contest.id, season.viewerId, season.majors[1]?.event.id);

    expect(count('ContestEntryPick.findMany')).toBe(1);
    expect(rows('ContestEntryPick.findMany')).toBe(ENTRIES * PICKS_PER_EVENT);
    expect(leaderboard.sportEventId).toBe(season.majors[1]?.event.id);
    expect(leaderboard.entries.map((entry) => [entry.entryName, entry.score, entry.position])).toEqual([
      ['Entry 1', -12, 1],
      ['Entry 2', -8, 2],
      ['Entry 3', -4, 3],
    ]);
  });

  it('answers a second viewer within 30 seconds from the board already computed, reading no entries or picks again', async () => {
    const season = await fourMajors(ContestStatus.ACTIVE, false);
    const { prisma, count } = countingPrisma(getPrisma());
    const service = serviceOn(prisma);

    const first = await service.getLeaderboard(season.contest.id, season.viewerId);
    const second = await service.getLeaderboard(season.contest.id, season.viewerId);

    expect(second).toEqual(first);
    expect(count('ContestEntry.findMany')).toBe(1);
    expect(count('ContestEntryPick.findMany')).toBe(1);
  });

  it('computes the live standings email\'s board afresh even when a viewer\'s board is cached, so an email never reports older scores', async () => {
    const season = await fourMajors(ContestStatus.ACTIVE, false);
    const { prisma, count } = countingPrisma(getPrisma());
    const service = serviceOn(prisma);

    const contest = expectDefined(await new PrismaContestRepository(prisma).findById(season.contest.id));

    await service.getLeaderboard(season.contest.id, season.viewerId);
    await service.leaderboardOf(contest);

    expect(count('ContestEntryPick.findMany')).toBe(2);
  });
  it('ranks a settled major\'s frozen results with a live major\'s real scores, totals frozen plus live, and level totals sharing a place', async () => {
    const settled = await createEvent('Masters', 200, SportEventStatus.COMPLETED);
    // Golfers 1 to 4 finish the live major at -5, -3, -2 and level par; two count per entry.
    const live = await createEvent('PGA', 1, SportEventStatus.IN_PROGRESS, [-5, -3, -2, 0]);
    const { contest, viewerId, addEntry, freeze } = await golfContest([settled, live]);
    const golfers = live.field.map((row) => row.id);
    const both = (liveGolfers: readonly (string | undefined)[]) => [
      { eventId: settled.event.id, fieldRowIds: [] },
      { eventId: live.event.id, fieldRowIds: liveGolfers.map((id) => expectDefined(id)) },
    ];
    const one = await addEntry('Entry 1', both([golfers[2], golfers[3]]));
    const two = await addEntry('Entry 2', both([golfers[1], golfers[3]]));
    const three = await addEntry('Entry 3', both([golfers[0], golfers[2]]));
    await freeze(one.id, settled.event.id, 1, -3);
    await freeze(two.id, settled.event.id, 2, -2);
    await freeze(three.id, settled.event.id, 3, -1);

    const leaderboard = await serviceOn(getPrisma()).getLeaderboard(contest.id, viewerId);

    // Entry 3: -1 + (-5 - 2) = -8. Entries 1 and 2: -3 + (-2 + 0) and -2 + (-3 + 0), both -5.
    expect(leaderboard.entries.map((entry) => [entry.entryName, entry.score, entry.position, entry.displayPosition])).toEqual([
      ['Entry 3', -8, 1, '1'],
      ['Entry 1', -5, 2, 'T2'],
      ['Entry 2', -5, 2, 'T2'],
    ]);
    const eventsOf = (entryId: string) => expectDefined(leaderboard.entries.find((entry) => entry.entryId === entryId)).events
      .map((event) => [event.sportEventId, event.position, event.score]);
    expect(eventsOf(one.id)).toEqual([[settled.event.id, 1, -3], [live.event.id, 3, -2]]);
    expect(eventsOf(two.id)).toEqual([[settled.event.id, 2, -2], [live.event.id, 2, -3]]);
    expect(eventsOf(three.id)).toEqual([[settled.event.id, 3, -1], [live.event.id, 1, -7]]);
  });

  it('counts a cancelled major for nothing and reads neither its field nor its picks, while its entries stay on the board', async () => {
    const cancelled = await createEvent('Masters', 200, SportEventStatus.CANCELLED);
    const live = await createEvent('PGA', 1, SportEventStatus.IN_PROGRESS, [-5, -3, -2, 0]);
    const { contest, viewerId, addEntry } = await golfContest([cancelled, live]);
    const [first, second] = [expectDefined(cancelled.field[0]).id, expectDefined(cancelled.field[1]).id];
    const onlyCancelled = await addEntry('Cancelled Only', [{ eventId: cancelled.event.id, fieldRowIds: [first, second] }]);
    const both = await addEntry('Both Majors', [
      { eventId: cancelled.event.id, fieldRowIds: [first, second] },
      { eventId: live.event.id, fieldRowIds: [expectDefined(live.field[0]).id, expectDefined(live.field[1]).id] },
    ]);
    const { prisma, reads } = fieldAndPickReadsOf(cancelled.event.id);

    const leaderboard = await serviceOn(prisma).getLeaderboard(contest.id, viewerId);

    expect(reads).toEqual([]);
    expect(leaderboard.sportEventId).toBe(live.event.id);
    expect(leaderboard.entries.map((entry) => [entry.entryId, entry.score, entry.events.map((event) => event.sportEventId)])).toEqual([
      [both.id, -8, [live.event.id]],
      [onlyCancelled.id, null, []],
    ]);
  });
});

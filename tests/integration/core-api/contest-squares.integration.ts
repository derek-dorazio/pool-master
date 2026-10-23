/**
 * Squares contests (#711) against Postgres: claiming and clearing boxes, recording the draw with
 * the entries it submits, freezing winners, and the guards that keep two claims off one box, an
 * entry within its box limit and the grid fixed once its digits are drawn.
 */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { holdContestLocks, waitUntilBlockedBy } from '../contest-lock';
import { ParticipantType, Sport } from '@poolmaster/shared/domain';
import {
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaSquaresRepository,
} from '../../../packages/core-api/src/adapters';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const IN_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const DRAWN_AT = new Date('2030-02-01T12:00:00.000Z');

interface SquaresFixture {
  contestId: string;
  sportEventId: string;
  gameId: string;
  userId: string;
  entryIds: [string, string];
}

async function seedSquaresContest(): Promise<SquaresFixture> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);

  const user = await prisma.user.create({
    data: { email: `squares-${suffix}@integration.test`, username: `squares-${suffix}`, firstName: 'Squares', lastName: 'Commissioner', isActive: true },
  });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `SQR${suffix.toUpperCase()}`, name: `Squares League ${suffix}`, iconKey: 'TROPHY' },
  });
  const squads = await Promise.all([1, 2].map((number) => prisma.squad.create({
    data: { leagueId: league.id, name: `Squares Squad ${number} ${suffix}`, createdBy: user.id },
  })));
  const sport = await prisma.sport.upsert({
    where: { sport: 'AMERICAN_FOOTBALL' },
    create: { sport: 'AMERICAN_FOOTBALL', participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `squares-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.AMERICAN_FOOTBALL,
      name: `Squares Event ${suffix}`,
      startDate: new Date('2030-02-03T23:30:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const [home, away] = await Promise.all(['Home', 'Away'].map(async (side) => {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `Squares ${side} ${suffix}`, participantType: ParticipantType.TEAM, externalIds: {} },
    });
    return prisma.sportEventParticipant.create({ data: { sportEventId: sportEvent.id, participantId: participant.id, isActive: true } });
  }));
  const round = await prisma.sportEventRound.create({
    data: { sportEventId: sportEvent.id, roundNumber: 1, scheduledDate: sportEvent.startDate },
  });
  const game = await prisma.sportEventMatch.create({
    data: {
      sportEventId: sportEvent.id, sportEventRoundId: round.id, matchNumber: 1, isNeutralSite: true,
      homeSportEventParticipantId: home.id, awaySportEventParticipantId: away.id,
    },
  });
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: sportEvent.id, sequence: 1 } },
      squaresGame: { create: { sportEventMatchId: game.id } },
      name: `Squares Contest ${suffix}`,
      status: 'OPEN',
      contestFormat: 'SQUARES',
      selectionType: 'SQUARES',
    },
  });
  const entries = await Promise.all(squads.map((squad, index) => prisma.contestEntry.create({
    data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: `Squares Entry ${index} ${suffix}`, events: { create: { sportEventId: sportEvent.id } } },
  })));
  const [first, second] = entries.map((entry) => entry.id);
  return { contestId: contest.id, sportEventId: sportEvent.id, gameId: game.id, userId: user.id, entryIds: [first, second] as [string, string] };
}

const claimOf = (fixture: SquaresFixture, entryId: string, rowIndex: number, columnIndex: number, maxSquaresPerEntry = 10) => ({
  contestId: fixture.contestId, contestEntryId: entryId, rowIndex, columnIndex, claimedByUserId: fixture.userId, maxSquaresPerEntry,
});

const drawOf = (fixture: SquaresFixture) => ({
  contestId: fixture.contestId, seed: 'integration-seed', rowDigits: IN_ORDER, columnDigits: [...IN_ORDER].reverse(),
  drawnByUserId: fixture.userId, sportEventId: fixture.sportEventId, drawnAt: DRAWN_AT,
});

describe('PrismaContestRepository on a squares contest', () => {
  it('reads the contest\'s game, and reads it as drawn once its digits are drawn', async () => {
    const prisma = getPrisma();
    const fixture = await seedSquaresContest();
    const contests = new PrismaContestRepository(prisma);

    expect(await contests.findById(fixture.contestId)).toMatchObject({ squaresGameMatchId: fixture.gameId });
    expect((await contests.findById(fixture.contestId))?.drawnAt).toBeUndefined();

    await new PrismaSquaresRepository(prisma).recordDraw(drawOf(fixture));

    expect((await contests.findById(fixture.contestId))?.drawnAt).toEqual(DRAWN_AT);
  });
});

describe('PrismaSquaresRepository claiming and clearing', () => {
  it('claims empty boxes and reads them by row then column', async () => {
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(getPrisma());
    const [first, second] = fixture.entryIds;

    expect(await squares.claim(claimOf(fixture, second, 3, 1))).toBe('claimed');
    expect(await squares.claim(claimOf(fixture, first, 0, 9))).toBe('claimed');

    expect((await squares.findSquares(fixture.contestId)).map((box) => [box.contestEntryId, box.rowIndex, box.columnIndex, box.claimedByUserId]))
      .toEqual([[first, 0, 9, fixture.userId], [second, 3, 1, fixture.userId]]);
  });

  it('refuses a box already held, keeping its holder', async () => {
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(getPrisma());
    const [first, second] = fixture.entryIds;
    await squares.claim(claimOf(fixture, first, 5, 5));

    expect(await squares.claim(claimOf(fixture, second, 5, 5))).toBe('taken');
    expect((await squares.findSquares(fixture.contestId)).map((box) => box.contestEntryId)).toEqual([first]);
  });

  it('refuses a claim past the entry\'s box limit', async () => {
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(getPrisma());
    const [first] = fixture.entryIds;
    await squares.claim(claimOf(fixture, first, 0, 0, 2));
    await squares.claim(claimOf(fixture, first, 0, 1, 2));

    expect(await squares.claim(claimOf(fixture, first, 0, 2, 2))).toBe('limitReached');
    expect(await squares.findSquares(fixture.contestId)).toHaveLength(2);
  });

  it('clears a held box only for its holder, and answers empty for a box nobody holds', async () => {
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(getPrisma());
    const [holder, other] = fixture.entryIds;
    await squares.claim(claimOf(fixture, holder, 2, 2));
    const box = { contestId: fixture.contestId, rowIndex: 2, columnIndex: 2 };

    expect(await squares.clear({ ...box, contestEntryId: other })).toBe('empty');
    expect(await squares.clear({ ...box, contestEntryId: holder })).toBe('cleared');
    expect(await squares.clear({ ...box, contestEntryId: holder })).toBe('empty');
    expect(await squares.findSquares(fixture.contestId)).toEqual([]);
  });

  it('refuses a box outside the 10x10 grid in the database', async () => {
    const fixture = await seedSquaresContest();
    await expect(getPrisma().contestEntrySquare.create({
      data: { contestId: fixture.contestId, contestEntryId: fixture.entryIds[0], rowIndex: 10, columnIndex: 0 },
    })).rejects.toThrow(/contest_entry_squares_position_check/);
  });

  it('refuses a box for an entry of another contest in the database', async () => {
    const fixture = await seedSquaresContest();
    const other = await seedSquaresContest();
    await expect(getPrisma().contestEntrySquare.create({
      data: { contestId: fixture.contestId, contestEntryId: other.entryIds[0], rowIndex: 0, columnIndex: 0 },
    })).rejects.toThrow();
  });
});

describe('PrismaSquaresRepository recording the draw', () => {
  it('writes the digits and submits every entry holding a box, leaving an entry without a box in draft', async () => {
    const prisma = getPrisma();
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(prisma);
    const [first, second] = fixture.entryIds;
    await squares.claim(claimOf(fixture, first, 4, 4));

    expect(await squares.recordDraw(drawOf(fixture))).toBe('drawn');

    expect(await squares.findDraw(fixture.contestId)).toEqual({
      contestId: fixture.contestId, seed: 'integration-seed', rowDigits: IN_ORDER, columnDigits: [...IN_ORDER].reverse(),
      drawnByUserId: fixture.userId, drawnAt: DRAWN_AT,
    });
    const statusOf = async (entryId: string) => (await prisma.contestEntryEvent.findFirstOrThrow({ where: { contestEntryId: entryId } })).status;
    expect(await statusOf(first)).toBe('SUBMITTED');
    expect(await statusOf(second)).toBe('DRAFT');
  });

  it('refuses a second draw, keeping the first draw\'s digits', async () => {
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(getPrisma());
    await squares.recordDraw(drawOf(fixture));

    expect(await squares.recordDraw({ ...drawOf(fixture), seed: 'second-seed', rowDigits: [...IN_ORDER].reverse() })).toBe('alreadyDrawn');
    expect((await squares.findDraw(fixture.contestId))?.seed).toBe('integration-seed');
  });

  it('refuses digits that are not 0 to 9 once each in the database', async () => {
    const fixture = await seedSquaresContest();
    await expect(getPrisma().contestSquaresDraw.create({
      data: { contestId: fixture.contestId, seed: 'bad', rowDigits: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8], columnDigits: IN_ORDER },
    })).rejects.toThrow(/contest_squares_draws_digits_check/);
  });

  it('refuses claiming and clearing once the digits are drawn', async () => {
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(getPrisma());
    await squares.claim(claimOf(fixture, fixture.entryIds[0], 1, 1));
    await squares.recordDraw(drawOf(fixture));

    expect(await squares.claim(claimOf(fixture, fixture.entryIds[0], 2, 2))).toBe('drawn');
    expect(await squares.clear({ contestId: fixture.contestId, contestEntryId: fixture.entryIds[0], rowIndex: 1, columnIndex: 1 })).toBe('drawn');
    expect(await squares.findSquares(fixture.contestId)).toHaveLength(1);
  });

  it('refuses an entry joining once the digits are drawn', async () => {
    const prisma = getPrisma();
    const fixture = await seedSquaresContest();
    await new PrismaSquaresRepository(prisma).recordDraw(drawOf(fixture));
    const entry = await prisma.contestEntry.findUniqueOrThrow({ where: { id: fixture.entryIds[0] } });

    expect(await new PrismaContestEntryRepository(prisma).create({
      contestId: fixture.contestId, squadId: entry.squadId, entryNumber: 2, name: 'Late Entry', tiebreakerValue: null,
    })).toEqual({ status: 'contestDrawn' });
  });
});

describe('a claim racing the draw', () => {
  it('makes a claim made while the draw is being recorded wait for it, then refuses the claim as drawn', async () => {
    const prisma = getPrisma();
    const fixture = await seedSquaresContest();

    const holder = holdContestLocks(prisma, [fixture.contestId], (tx) => tx.contestSquaresDraw.create({
      data: { contestId: fixture.contestId, seed: 'held-seed', rowDigits: IN_ORDER, columnDigits: IN_ORDER, drawnByUserId: fixture.userId },
    }));
    const holderPid = await holder.ready;
    const claimed = new PrismaSquaresRepository(prisma).claim(claimOf(fixture, fixture.entryIds[0], 0, 0));
    await waitUntilBlockedBy(prisma, holderPid).finally(() => holder.release());

    expect(await claimed).toBe('drawn');
    expect(await prisma.contestEntrySquare.count({ where: { contestId: fixture.contestId } })).toBe(0);
  });

  it('makes a draw recorded while a box is being claimed wait for it, then submits the entry that claimed it', async () => {
    const prisma = getPrisma();
    const fixture = await seedSquaresContest();
    const [first] = fixture.entryIds;

    const holder = holdContestLocks(prisma, [fixture.contestId], (tx) => tx.contestEntrySquare.create({
      data: { contestId: fixture.contestId, contestEntryId: first, rowIndex: 0, columnIndex: 0 },
    }));
    const holderPid = await holder.ready;
    const drawn = new PrismaSquaresRepository(prisma).recordDraw(drawOf(fixture));
    await waitUntilBlockedBy(prisma, holderPid).finally(() => holder.release());

    expect(await drawn).toBe('drawn');
    expect((await prisma.contestEntryEvent.findFirstOrThrow({ where: { contestEntryId: first } })).status).toBe('SUBMITTED');
  });
});

describe('PrismaSquaresRepository frozen winners', () => {
  it('replaces the contest\'s winners and reads them by period, an unclaimed box with no entry', async () => {
    const fixture = await seedSquaresContest();
    const squares = new PrismaSquaresRepository(getPrisma());
    const [first, second] = fixture.entryIds;
    const winner = (periodNumber: number, contestEntryId: string | null) => ({
      contestId: fixture.contestId, periodNumber, homeScore: periodNumber * 7, awayScore: 3, rowIndex: 3, columnIndex: periodNumber, contestEntryId, settledAt: DRAWN_AT,
    });
    await squares.replaceWinners(fixture.contestId, [winner(2, first), winner(1, second)]);
    await squares.replaceWinners(fixture.contestId, [winner(4, null), winner(1, first)]);

    expect((await squares.findWinners(fixture.contestId)).map((each) => [each.periodNumber, each.contestEntryId])).toEqual([[1, first], [4, null]]);
  });
});

/**
 * Recording a random draw (#601) against Postgres: the one transaction that writes the draw
 * row, every dealt pick and every entry's submission, and the guards that keep a contest from
 * being dealt twice or half dealt.
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
  ContestDrawAlreadyRunError,
  ContestDrawEntriesChangedError,
  ContestEntryPickService,
} from '../../../packages/core-api/src/modules/contest-entry-picks';
import { PrismaContestEntryRepository, PrismaContestRepository } from '../../../packages/core-api/src/adapters';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

interface DrawFixture {
  contestId: string;
  sportEventId: string;
  userId: string;
  entryIds: [string, string];
  fieldIds: string[];
}

async function seedRandomDrawContest(): Promise<DrawFixture> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);

  const user = await prisma.user.create({
    data: {
      email: `draw-${suffix}@integration.test`,
      username: `draw-${suffix}`,
      firstName: 'Draw',
      lastName: 'Commissioner',
      isActive: true,
    },
  });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `DRW${suffix.toUpperCase()}`, name: `Draw League ${suffix}`, iconKey: 'TROPHY' },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const squads = await Promise.all([1, 2].map((number) => prisma.squad.create({
    data: { leagueId: league.id, name: `Draw Squad ${number} ${suffix}`, createdBy: user.id },
  })));

  const sport = await prisma.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `draw-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Draw Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const fieldIds: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `Draw Golfer ${index} ${suffix}`, participantType: ParticipantType.INDIVIDUAL, externalIds: {} },
    });
    const row = await prisma.sportEventParticipant.create({
      data: { sportEventId: sportEvent.id, participantId: participant.id, isActive: true },
    });
    fieldIds.push(row.id);
  }
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: sportEvent.id, sequence: 1 } },
      name: `Draw Contest ${suffix}`,
      status: 'OPEN',
      contestFormat: 'ROSTER',
      selectionType: 'RANDOM_DRAW',
    },
  });
  const entries = await Promise.all(squads.map((squad, index) => prisma.contestEntry.create({
    data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: `Draw Entry ${index} ${suffix}`, events: { create: { sportEventId: sportEvent.id } } },
  })));
  const [first, second] = entries.map((entry) => entry.id);

  return { contestId: contest.id, sportEventId: sportEvent.id, userId: user.id, entryIds: [first, second] as [string, string], fieldIds };
}

function drawOf(fixture: DrawFixture) {
  const [first, second] = fixture.entryIds;
  const [a, b, c, d] = fixture.fieldIds;
  return {
    contestId: fixture.contestId,
    seed: 'integration-seed',
    fieldOrder: [c, a, d, b] as string[],
    entryOrder: [second, first],
    drawnByUserId: fixture.userId,
    entries: [
      { entryId: second, sportEventParticipantIds: [c, d] as string[] },
      { entryId: first, sportEventParticipantIds: [a, b] as string[] },
    ],
  };
}

describe('ContestEntryPickService.recordDraw', () => {
  it('writes the draw, every dealt pick with its round and deal order, and submits every entry, and the contest then reads as drawn', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();
    const draw = drawOf(fixture);
    const [first, second] = fixture.entryIds;

    await new ContestEntryPickService(prisma).recordDraw(draw);

    const stored = await prisma.contestDraw.findUniqueOrThrow({ where: { contestId: fixture.contestId } });
    expect(stored).toMatchObject({
      seed: 'integration-seed',
      fieldOrder: draw.fieldOrder,
      entryOrder: [second, first],
      drawnByUserId: fixture.userId,
    });
    const picks = await prisma.contestEntryPick.findMany({
      where: { entry: { contestId: fixture.contestId } },
      orderBy: { pickSequence: 'asc' },
    });
    expect(picks.map((pick) => [pick.entryId, pick.sportEventParticipantId, pick.lineupSlot, pick.pickSequence, pick.contestFormat, pick.isAutoPicked]))
      .toEqual([
        [second, draw.fieldOrder[0], 1, 1, 'ROSTER', true],
        [first, draw.fieldOrder[1], 1, 2, 'ROSTER', true],
        [second, draw.fieldOrder[2], 2, 3, 'ROSTER', true],
        [first, draw.fieldOrder[3], 2, 4, 'ROSTER', true],
      ]);
    const entries = await prisma.contestEntryEvent.findMany({ where: { contestEntry: { contestId: fixture.contestId } } });
    expect(entries.map((entry) => entry.status)).toEqual(['SUBMITTED', 'SUBMITTED']);

    const contest = await new PrismaContestRepository(prisma).findById(fixture.contestId);
    expect(contest?.drawnAt).toEqual(stored.drawnAt);
  });

  it('answers with the stored draw time, which is also every entry\'s submit time, so the room can show the draw without reading it back (#1196)', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();

    const { drawnAt } = await new ContestEntryPickService(prisma).recordDraw(drawOf(fixture));

    const stored = await prisma.contestDraw.findUniqueOrThrow({ where: { contestId: fixture.contestId } });
    expect(drawnAt).toEqual(stored.drawnAt);
    const entries = await prisma.contestEntryEvent.findMany({ where: { contestEntry: { contestId: fixture.contestId } } });
    expect(entries.map((entry) => entry.submittedAt)).toEqual([drawnAt, drawnAt]);
  });

  it('refuses a second draw of the same contest and writes nothing more', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();
    const service = new ContestEntryPickService(prisma);
    await service.recordDraw(drawOf(fixture));

    await expect(service.recordDraw({ ...drawOf(fixture), seed: 'second-seed' }))
      .rejects.toBeInstanceOf(ContestDrawAlreadyRunError);

    expect(await prisma.contestEntryPick.count({ where: { entry: { contestId: fixture.contestId } } })).toBe(4);
    expect((await prisma.contestDraw.findUniqueOrThrow({ where: { contestId: fixture.contestId } })).seed).toBe('integration-seed');
  });

  it('refuses a deal that leaves out one of the contest\'s entries, writing no draw, pick or submission', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();
    const draw = drawOf(fixture);

    await expect(new ContestEntryPickService(prisma).recordDraw({ ...draw, entries: draw.entries.slice(0, 1) }))
      .rejects.toBeInstanceOf(ContestDrawEntriesChangedError);

    expect(await prisma.contestDraw.count({ where: { contestId: fixture.contestId } })).toBe(0);
    expect(await prisma.contestEntryPick.count({ where: { entry: { contestId: fixture.contestId } } })).toBe(0);
    const entries = await prisma.contestEntryEvent.findMany({ where: { contestEntry: { contestId: fixture.contestId } } });
    expect(entries.map((entry) => entry.status)).toEqual(['DRAFT', 'DRAFT']);
  });

  it('reads a contest that has not been drawn with no draw time', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();

    const contest = await new PrismaContestRepository(prisma).findById(fixture.contestId);

    expect(contest?.drawnAt).toBeUndefined();
  });
});

describe('a draw racing an entry write', () => {
  it('waits for an entry being created and then refuses the draw as entries changed, leaving no entry submitted without picks', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();
    const [first] = fixture.entryIds;
    const firstEntry = await prisma.contestEntry.findUniqueOrThrow({ where: { id: first } });

    const holder = holdContestLocks(prisma, [fixture.contestId], (tx) => tx.contestEntry.create({
      data: {
        contestId: fixture.contestId,
        squadId: firstEntry.squadId,
        entryNumber: 2,
        name: 'Late Entry',
        events: { create: { sportEventId: fixture.sportEventId } },
      },
    }));
    const holderPid = await holder.ready;
    const draw = new ContestEntryPickService(prisma).recordDraw(drawOf(fixture)).then(() => 'recorded', (error: unknown) => error);
    await waitUntilBlockedBy(prisma, holderPid).finally(() => holder.release());

    expect(await draw).toBeInstanceOf(ContestDrawEntriesChangedError);
    expect(await prisma.contestDraw.count({ where: { contestId: fixture.contestId } })).toBe(0);
    const entries = await prisma.contestEntryEvent.findMany({ where: { contestEntry: { contestId: fixture.contestId } } });
    expect(entries.map((entry) => entry.status)).toEqual(['DRAFT', 'DRAFT', 'DRAFT']);
  });

  it('makes an entry created while a draw is being recorded wait for it, then refuses the entry because the contest is drawn', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();
    const [first] = fixture.entryIds;
    const firstEntry = await prisma.contestEntry.findUniqueOrThrow({ where: { id: first } });

    const holder = holdContestLocks(prisma, [fixture.contestId], (tx) => tx.contestDraw.create({
      data: { contestId: fixture.contestId, seed: 'held-seed', fieldOrder: [], entryOrder: [], drawnByUserId: fixture.userId },
    }));
    const holderPid = await holder.ready;
    const created = new PrismaContestEntryRepository(prisma).create({
      contestId: fixture.contestId,
      squadId: firstEntry.squadId,
      entryNumber: 2,
      name: 'Late Entry',
      tiebreakerValue: null,
    }, { entriesPerContest: () => null });
    await waitUntilBlockedBy(prisma, holderPid).finally(() => holder.release());

    expect(await created).toEqual({ status: 'contestDrawn' });
    expect(await prisma.contestEntry.count({ where: { contestId: fixture.contestId } })).toBe(2);
  });

  it('makes an entry leaving while a draw is being recorded wait for it, then refuses to delete it because the contest is drawn', async () => {
    const prisma = getPrisma();
    const fixture = await seedRandomDrawContest();
    const [first] = fixture.entryIds;

    const holder = holdContestLocks(prisma, [fixture.contestId], (tx) => tx.contestDraw.create({
      data: { contestId: fixture.contestId, seed: 'held-seed', fieldOrder: [], entryOrder: [], drawnByUserId: fixture.userId },
    }));
    const holderPid = await holder.ready;
    const deleted = new PrismaContestEntryRepository(prisma).delete(first);
    await waitUntilBlockedBy(prisma, holderPid).finally(() => holder.release());

    expect(await deleted).toEqual({ status: 'contestDrawn' });
    expect(await prisma.contestEntry.count({ where: { contestId: fixture.contestId } })).toBe(2);
  });
});

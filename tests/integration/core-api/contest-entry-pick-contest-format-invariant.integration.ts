/**
 * ContestEntryPick.contestFormat is denormalized from the parent contest
 * (plans/117 §7.1) so partial unique indexes can predicate on a local column.
 * ROSTER is the only format since #605, so this checks the copy is made; the
 * per-format cross-checks went with the formats. It also covers the rest of the one pick-change
 * path, `changeEntryPick` (#1259): numbering, swaps, removals and the entry row lock, and how it
 * and `settleEntryEvent` settle the entry's status under that lock (#1300).
 */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { ContestEntryStatus, ParticipantType, Sport } from '@poolmaster/shared/domain';
import {
  ContestEntryPickService,
} from '../../../packages/core-api/src/modules/contest-entry-picks';
import { freshEventEdition } from '../../support/event-edition';
import { holdEntryLock, waitUntilBlockedBy } from '../contest-lock';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

interface FormatFixture {
  contestId: string;
  entryId: string;
  sportEventId: string;
  /** Two golfers in the event's field. */
  fieldIds: [string, string];
}

async function seedFixtureForFormat(contestFormat: string): Promise<FormatFixture> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);

  const user = await prisma.user.create({
    data: {
      email: `pick-invariant-${suffix}@example.com`,
      username: `pick-invariant-${suffix}`,
      firstName: 'Invariant',
      lastName: 'Pick',
      isActive: true,
    },
  });
  const league = await prisma.league.create({
    data: {
      cupName: 'Test Cup', leagueCode: `PIN${suffix.toUpperCase()}`,
      name: `Invariant League ${suffix}`,
      iconKey: 'TROPHY',
    },
  });
  await prisma.leagueMembership.create({
    data: {
      leagueId: league.id,
      userId: user.id,
      role: 'COMMISSIONER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  const squad = await prisma.squad.create({
    data: {
      leagueId: league.id,
      name: `Invariant Squad ${suffix}`,
      createdBy: user.id,
    },
  });

  const sport = await prisma.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const sportEvent = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `pick-invariant-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Invariant Event ${suffix}`,
      startDate: new Date('2030-01-01T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const fieldIds: [string, string] = ['', ''];
  for (const [index, name] of (['One', 'Two'] as const).entries()) {
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: `Invariant Participant ${name} ${suffix}`,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
      },
    });
    const sep = await prisma.sportEventParticipant.create({
      data: { sportEventId: sportEvent.id, participantId: participant.id, isActive: true },
    });
    fieldIds[index] = sep.id;
  }
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: sportEvent.id, sequence: 1 } },
      name: `Invariant Contest ${suffix}`,
      status: 'OPEN',
      contestFormat: contestFormat as 'ROSTER',
      selectionType: 'TIERED',
    },
  });
  const entry = await prisma.contestEntry.create({
    data: {
      contestId: contest.id,
      squadId: squad.id,
      entryNumber: 1,
      name: `Invariant Entry ${suffix}`,
      events: { create: { sportEventId: sportEvent.id, status: 'SUBMITTED', submittedAt: new Date() } },
    },
  });

  return {
    contestId: contest.id,
    entryId: entry.id,
    sportEventId: sportEvent.id,
    fieldIds,
  };
}

/** A pick change that leaves the entry's status as it is. */
const unsettled = { at: new Date('2026-06-01T12:00:00.000Z'), settle: () => null };
const add = (sportEventParticipantId: string, lineupSlot = 1) => ({ removePickId: null, add: { sportEventParticipantId, lineupSlot } });

describe('ContestEntryPick.contestFormat denormalization', () => {
  it('copies the parent contest\'s format onto the pick row a pick change adds', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');

    const result = await service.changeEntryPick({
      entryId: fixture.entryId,
      sportEventId: fixture.sportEventId,
      ...unsettled,
      decide: () => add(fixture.fieldIds[0]),
    });

    const row = await prisma.contestEntryPick.findFirstOrThrow({ where: { entryId: fixture.entryId } });
    expect(result).toMatchObject({ picksChanged: true, statusChanged: false });
    expect(row).toEqual(expect.objectContaining({
      contestFormat: 'ROSTER',
      sportEventParticipantId: fixture.fieldIds[0],
      lineupSlot: 1,
      isAutoPicked: false,
    }));
  });
});

describe('ContestEntryPickService.changeEntryPick', () => {
  it('numbers an added pick after every pick the whole contest holds, not just the entry\'s', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');
    const squad = await prisma.contestEntry.findUniqueOrThrow({ where: { id: fixture.entryId }, select: { squadId: true } });
    const rival = await prisma.contestEntry.create({
      data: { contestId: fixture.contestId, squadId: squad.squadId, entryNumber: 2, name: 'Rival entry' },
    });
    await service.changeEntryPick({ entryId: rival.id, sportEventId: fixture.sportEventId, ...unsettled, decide: () => add(fixture.fieldIds[0]) });

    await service.changeEntryPick({ entryId: fixture.entryId, sportEventId: fixture.sportEventId, ...unsettled, decide: () => add(fixture.fieldIds[1]) });

    const row = await prisma.contestEntryPick.findFirstOrThrow({ where: { entryId: fixture.entryId } });
    expect(row.pickSequence).toBe(2);
  });

  it('hands decide the entry\'s picks in the event, and swaps one out for another in one change', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');
    await service.changeEntryPick({ entryId: fixture.entryId, sportEventId: fixture.sportEventId, ...unsettled, decide: () => add(fixture.fieldIds[0]) });
    const first = await prisma.contestEntryPick.findFirstOrThrow({ where: { entryId: fixture.entryId } });
    const seen: unknown[] = [];

    const result = await service.changeEntryPick({
      entryId: fixture.entryId,
      sportEventId: fixture.sportEventId,
      ...unsettled,
      decide: (picks) => {
        seen.push(...picks);
        return { removePickId: first.id, add: { sportEventParticipantId: fixture.fieldIds[1], lineupSlot: 1 } };
      },
    });

    const participant = await prisma.sportEventParticipant.findUniqueOrThrow({ where: { id: fixture.fieldIds[0] } });
    expect(seen).toEqual([{ id: first.id, sportEventParticipantId: fixture.fieldIds[0], participantId: participant.participantId, lineupSlot: 1 }]);
    expect(result).toMatchObject({ picksChanged: true, statusChanged: false });
    const remaining = await prisma.contestEntryPick.findMany({ where: { entryId: fixture.entryId } });
    expect(remaining.map((pick) => pick.sportEventParticipantId)).toEqual([fixture.fieldIds[1]]);
  });

  it('removes only the pick named, leaving the entry and its other picks in place', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');
    await service.changeEntryPick({ entryId: fixture.entryId, sportEventId: fixture.sportEventId, ...unsettled, decide: () => add(fixture.fieldIds[0], 1) });
    await service.changeEntryPick({ entryId: fixture.entryId, sportEventId: fixture.sportEventId, ...unsettled, decide: () => add(fixture.fieldIds[1], 2) });
    const removed = await prisma.contestEntryPick.findFirstOrThrow({ where: { entryId: fixture.entryId, sportEventParticipantId: fixture.fieldIds[1] } });

    await service.changeEntryPick({
      entryId: fixture.entryId,
      sportEventId: fixture.sportEventId,
      ...unsettled,
      decide: () => ({ removePickId: removed.id, add: null }),
    });

    const remaining = await prisma.contestEntryPick.findMany({ where: { entryId: fixture.entryId } });
    expect(remaining.map((pick) => pick.sportEventParticipantId)).toEqual([fixture.fieldIds[0]]);
    await expect(prisma.contestEntry.count({ where: { id: fixture.entryId } })).resolves.toBe(1);
  });

  it('writes nothing and answers unchanged when decide declines the change', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');

    const result = await service.changeEntryPick({ entryId: fixture.entryId, sportEventId: fixture.sportEventId, ...unsettled, decide: () => null });

    expect(result).toMatchObject({ picksChanged: false, statusChanged: false });
    await expect(prisma.contestEntryPick.count({ where: { entryId: fixture.entryId } })).resolves.toBe(0);
  });

  it('waits on the entry\'s row lock and decides on the pick the holder committed, so two changes never decide on the same picks', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');
    // The holder adds the first golfer under the entry's lock, as a concurrent pick change would.
    const holder = holdEntryLock(prisma, fixture.entryId, async (tx) => {
      await tx.contestEntryPick.create({
        data: { entryId: fixture.entryId, sportEventParticipantId: fixture.fieldIds[0], contestFormat: 'ROSTER', lineupSlot: 1 },
      });
    });
    const holderPid = await holder.ready;
    const seen: string[] = [];

    const change = service.changeEntryPick({
      entryId: fixture.entryId,
      sportEventId: fixture.sportEventId,
      ...unsettled,
      decide: (picks) => {
        seen.push(...picks.map((pick) => pick.sportEventParticipantId));
        // A one-place roster: full once the holder's pick is there.
        return picks.length >= 1 ? null : add(fixture.fieldIds[1]);
      },
    });
    await waitUntilBlockedBy(prisma, holderPid);
    await holder.release();

    await expect(change).resolves.toMatchObject({ picksChanged: false, statusChanged: false });
    expect(seen).toEqual([fixture.fieldIds[0]]);
    const rows = await prisma.contestEntryPick.findMany({ where: { entryId: fixture.entryId } });
    expect(rows.map((row) => row.sportEventParticipantId)).toEqual([fixture.fieldIds[0]]);
  });
});

describe('ContestEntryPickService settling an entry\'s status under its lock (#1300)', () => {
  const eventRow = (fixture: FormatFixture) => getPrisma().contestEntryEvent.findUniqueOrThrow({
    where: { contestEntryId_sportEventId: { contestEntryId: fixture.entryId, sportEventId: fixture.sportEventId } },
  });

  it('hands settle the lineup a change left and the status read under the lock, and returns the entry to DRAFT with its submit time cleared', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');
    const seen: unknown[] = [];

    const result = await service.changeEntryPick({
      entryId: fixture.entryId,
      sportEventId: fixture.sportEventId,
      at: new Date('2026-06-01T12:00:00.000Z'),
      decide: () => add(fixture.fieldIds[0]),
      settle: (state) => {
        seen.push({ status: state.status, picksChanged: state.picksChanged, picks: state.picks.map((pick) => pick.sportEventParticipantId) });
        return ContestEntryStatus.DRAFT;
      },
    });

    expect(seen).toEqual([{ status: ContestEntryStatus.SUBMITTED, picksChanged: true, picks: [fixture.fieldIds[0]] }]);
    expect(result).toEqual({ picksChanged: true, status: ContestEntryStatus.DRAFT, submittedAt: null, statusChanged: true });
    expect(await eventRow(fixture)).toMatchObject({ status: ContestEntryStatus.DRAFT, submittedAt: null });
  });

  it('writes neither the pick nor the status when settle refuses the change', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');

    await expect(service.changeEntryPick({
      entryId: fixture.entryId,
      sportEventId: fixture.sportEventId,
      at: new Date(),
      decide: () => add(fixture.fieldIds[0]),
      settle: () => { throw new Error('refused'); },
    })).rejects.toThrow('refused');

    await expect(prisma.contestEntryPick.count({ where: { entryId: fixture.entryId } })).resolves.toBe(0);
    expect(await eventRow(fixture)).toMatchObject({ status: ContestEntryStatus.SUBMITTED });
  });

  it('submits an event with no pick write, stamping its submit time, and answers unchanged for one already submitted', async () => {
    const prisma = getPrisma();
    const service = new ContestEntryPickService(prisma);
    const fixture = await seedFixtureForFormat('ROSTER');
    await prisma.contestEntryEvent.update({
      where: { contestEntryId_sportEventId: { contestEntryId: fixture.entryId, sportEventId: fixture.sportEventId } },
      data: { status: ContestEntryStatus.DRAFT, submittedAt: null },
    });
    const at = new Date('2026-06-02T08:00:00.000Z');
    const submit = () => service.settleEntryEvent({
      entryId: fixture.entryId,
      sportEventId: fixture.sportEventId,
      at,
      settle: ({ status }) => (status === ContestEntryStatus.SUBMITTED ? null : ContestEntryStatus.SUBMITTED),
    });

    await expect(submit()).resolves.toEqual({ picksChanged: false, status: ContestEntryStatus.SUBMITTED, submittedAt: at, statusChanged: true });
    expect(await eventRow(fixture)).toMatchObject({ status: ContestEntryStatus.SUBMITTED, submittedAt: at });
    await expect(submit()).resolves.toEqual({ picksChanged: false, status: ContestEntryStatus.SUBMITTED, submittedAt: at, statusChanged: false });
  });
});

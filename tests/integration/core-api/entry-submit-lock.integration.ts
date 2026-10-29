/**
 * #1300 — a submit and a pick change on one entry take the entry's row lock and judge the lineup
 * and the entry's status under it, so neither decides on what the other is about to change.
 *
 * Each case holds the entry's lock in a transaction of its own, as the other writer would, makes
 * that writer's change in it, starts the request under test, waits until Postgres reports it
 * blocked behind the holder, and only then commits. The interleaving is fixed, not timed.
 */
import { ContestEntryStatus, ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import { expectDefined } from '../../support/expect-defined';
import {
  authHeaders,
  cleanupTestData,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { holdEntryLock, waitUntilBlockedBy } from '../contest-lock';
import { seedEventWithField, seedLeagueWithTeams, seedTiers } from '../list-route-seeds';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/**
 * An OPEN two-tier golf contest, one golfer a tier, and one team's entry holding both golfers
 * with the event in `status`: a complete lineup.
 */
async function seedFullEntry(status: ContestEntryStatus) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(1);
  const squad = expectDefined(seeded.squads[0]);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: squad.createdBy } });
  const { event, field } = await seedEventWithField(2);
  await seedTiers(event.id, field, 2);
  const contest = await prisma.contest.create({
    data: {
      leagueId: seeded.league.id,
      seasonYear: event.startDate.getUTCFullYear(),
      sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
      name: `Lock ${seeded.suffix}`,
      status: ContestStatus.OPEN,
      contestFormat: 'ROSTER',
      selectionType: SelectionType.TIERED,
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: SelectionType.TIERED,
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 2 },
    },
  });
  const entry = await prisma.contestEntry.create({
    data: {
      contestId: contest.id,
      squadId: squad.id,
      entryNumber: 1,
      name: squad.name,
      events: { create: { sportEventId: event.id, status, submittedAt: status === ContestEntryStatus.SUBMITTED ? new Date() : null } },
    },
  });
  await prisma.contestEntryPick.createMany({
    data: field.map((row, index) => ({
      entryId: entry.id, sportEventParticipantId: row.id, contestFormat: 'ROSTER' as const, lineupSlot: index + 1,
    })),
  });
  return { contest, entry, event, field, headers: authHeaders(owner.id, owner.email) };
}

async function eventStatus(entryId: string, sportEventId: string): Promise<string> {
  const row = await getPrisma().contestEntryEvent.findUniqueOrThrow({
    where: { contestEntryId_sportEventId: { contestEntryId: entryId, sportEventId } },
  });
  return row.status;
}

describe('a submit and a pick change on one entry wait on its row lock (#1300)', () => {
  it('makes a submit wait for an unselect in flight and refuse the lineup the unselect left short', async () => {
    const prisma = getPrisma();
    const { contest, entry, event, field, headers } = await seedFullEntry(ContestEntryStatus.DRAFT);
    const removed = expectDefined(field[1]);
    // The unselect, holding the entry's lock: its delete is made but not yet committed.
    const unselect = holdEntryLock(prisma, entry.id, async (tx) => {
      await tx.contestEntryPick.deleteMany({ where: { entryId: entry.id, sportEventParticipantId: removed.id } });
    });
    const holderPid = await unselect.ready;

    const submit = getApp().inject({
      method: 'POST',
      url: `/api/v1/selections/${contest.id}/entries/${entry.id}/events/${event.id}/submit`,
      headers: withoutJsonBodyHeaders(headers),
    });
    await waitUntilBlockedBy(prisma, holderPid);
    await unselect.release();

    const answer = await submit;
    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ error: { code: 'ENTRY_LINEUP_INCOMPLETE' } });
    expect(await eventStatus(entry.id, event.id)).toBe(ContestEntryStatus.DRAFT);
  });

  it('sends a lineup back to DRAFT when a submit committed while the unselect waited on the lock', async () => {
    const prisma = getPrisma();
    const { contest, entry, event, field, headers } = await seedFullEntry(ContestEntryStatus.DRAFT);
    const removed = expectDefined(field[1]);
    // The submit, holding the entry's lock: the full lineup is SUBMITTED but not yet committed.
    const submit = holdEntryLock(prisma, entry.id, async (tx) => {
      await tx.contestEntryEvent.update({
        where: { contestEntryId_sportEventId: { contestEntryId: entry.id, sportEventId: event.id } },
        data: { status: ContestEntryStatus.SUBMITTED, submittedAt: new Date() },
      });
    });
    const holderPid = await submit.ready;

    const unselect = getApp().inject({
      method: 'DELETE',
      url: `/api/v1/selections/${contest.id}/entries/${entry.id}/picks/${removed.id}`,
      headers: withoutJsonBodyHeaders(headers),
    });
    await waitUntilBlockedBy(prisma, holderPid);
    await submit.release();

    const answer = await unselect;
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({ entryStatus: ContestEntryStatus.DRAFT });
    expect(await eventStatus(entry.id, event.id)).toBe(ContestEntryStatus.DRAFT);
    await expect(prisma.contestEntryPick.count({ where: { entryId: entry.id } })).resolves.toBe(1);
  });
});

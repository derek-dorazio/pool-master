/**
 * #1195 — the nightly cleanup's abandoned-draft step against Postgres: a DRAFT contest whose last
 * event started more than 90 days ago is deleted with its own setup rows (event links,
 * configuration, scoring rules, prize definitions), in set-based deletes. Newer drafts, drafts
 * with no event, and contests that were opened are kept, at any age.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ContestStatus } from '@poolmaster/shared/domain';
import { PrismaContestRepository } from '../../../packages/core-api/src/adapters';
import { AbandonedDraftRetention } from '../../../packages/core-api/src/modules/contests/abandoned-draft-retention';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { holdContestLocks, waitUntilBlockedBy } from '../contest-lock';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, seedEventWithField, seedLeagueWithTeams } from '../list-route-seeds';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/**
 * Every contest this suite seeds carries this name prefix, so its reads count only its own rows:
 * suites share one database, and a contest another suite left behind must not change a count here.
 */
const CONTEST_NAME_PREFIX = 'Retention ';

/** A contest of `status` in the league on the events, set up as the commissioner's form leaves one. */
async function seedContest(leagueId: string, status: ContestStatus, sportEventIds: readonly string[]) {
  const prisma = getPrisma();
  return prisma.contest.create({
    data: {
      leagueId,
      seasonYear: 2026,
      name: `${CONTEST_NAME_PREFIX}${status} ${randomUUID().slice(0, 8)}`,
      status,
      selectionType: 'TIERED',
      sportEvents: { create: sportEventIds.map((sportEventId, index) => ({ sportEventId, sequence: index + 1 })) },
      configuration: {
        create: {
          selectionType: 'TIERED',
          participantScoringRules: { create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 } },
          prizeDefinitions: { create: { prizeDefinitionId: 'WINNER', displayName: 'Winner', sortOrder: 1 } },
        },
      },
    },
    include: { configuration: { select: { id: true } } },
  });
}

async function eventStarted(daysAgo: number) {
  return (await seedEventWithField(0, { startsInDays: -daysAgo })).event;
}

function retention() {
  return new AbandonedDraftRetention(new PrismaContestRepository(getAppPrisma()), fakeLogger());
}

async function remainingContestIds(): Promise<string[]> {
  const contests = await getPrisma().contest.findMany({
    where: { name: { startsWith: CONTEST_NAME_PREFIX } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return contests.map((contest) => contest.id);
}

describe('abandoned draft contest retention (#1195)', () => {
  it('deletes a draft whose only event started more than 90 days ago, with its event links, configuration, scoring rules and prize definitions, and keeps the event', async () => {
    const { league } = await seedLeagueWithTeams(0);
    const event = await eventStarted(91);
    const draft = await seedContest(league.id, ContestStatus.DRAFT, [event.id]);

    expect(await retention().purge(new Date())).toBe(1);

    const prisma = getPrisma();
    expect(await remainingContestIds()).toEqual([]);
    await expect(prisma.contestSportEvent.count({ where: { contestId: draft.id } })).resolves.toBe(0);
    await expect(prisma.contestConfiguration.count({ where: { contestId: draft.id } })).resolves.toBe(0);
    const contestConfigurationId = expectDefined(draft.configuration, 'the draft configuration').id;
    await expect(prisma.participantContestScoringRule.count({ where: { contestConfigurationId } })).resolves.toBe(0);
    await expect(prisma.contestPrizeDefinition.count({ where: { contestConfigurationId } })).resolves.toBe(0);
    await expect(prisma.sportEvent.count({ where: { id: event.id } })).resolves.toBe(1);
  });

  it('keeps a draft whose last event started 90 days ago or less, even when its earlier events are older', async () => {
    const { league } = await seedLeagueWithTeams(0);
    const old = await eventStarted(120);
    const recent = await eventStarted(89);
    const kept = [
      await seedContest(league.id, ContestStatus.DRAFT, [recent.id]),
      await seedContest(league.id, ContestStatus.DRAFT, [old.id, recent.id]),
    ];
    const now = new Date();
    // An event that started exactly 90 days before the run is still inside the horizon.
    const onTheLine = await eventStarted(80);
    await getPrisma().sportEvent.update({ where: { id: onTheLine.id }, data: { startDate: new Date(now.getTime() - 90 * DAY) } });
    kept.push(await seedContest(league.id, ContestStatus.DRAFT, [onTheLine.id]));

    expect(await retention().purge(now)).toBe(0);

    expect(await remainingContestIds()).toEqual(kept.map((contest) => contest.id).sort());
  });

  it('keeps a draft with no event, which has no start date to age by', async () => {
    const { league } = await seedLeagueWithTeams(0);
    const draft = await seedContest(league.id, ContestStatus.DRAFT, []);

    expect(await retention().purge(new Date())).toBe(0);

    expect(await remainingContestIds()).toEqual([draft.id]);
  });

  it('keeps OPEN, ACTIVE and COMPLETED contests however long ago their events started', async () => {
    const { league } = await seedLeagueWithTeams(0);
    const event = await eventStarted(400);
    const kept = [
      await seedContest(league.id, ContestStatus.OPEN, [event.id]),
      await seedContest(league.id, ContestStatus.ACTIVE, [event.id]),
      await seedContest(league.id, ContestStatus.COMPLETED, [event.id]),
    ];

    expect(await retention().purge(new Date())).toBe(0);

    expect(await remainingContestIds()).toEqual(kept.map((contest) => contest.id).sort());
    await expect(getPrisma().contestConfiguration.count({ where: { contestId: { in: kept.map((contest) => contest.id) } } })).resolves.toBe(3);
  });

  it('deletes abandoned drafts across leagues in bounded batches until a batch comes back short', async () => {
    const event = await eventStarted(100);
    const leagues = [(await seedLeagueWithTeams(0)).league, (await seedLeagueWithTeams(0)).league];
    for (let index = 0; index < 5; index += 1) {
      await seedContest(leagues[index % 2].id, ContestStatus.DRAFT, [event.id]);
    }
    const contests = new PrismaContestRepository(getAppPrisma());
    const cutoff = new Date(Date.now() - 90 * DAY);

    const first = await contests.deleteAbandonedDraftsBatch(cutoff, 2);
    const second = await contests.deleteAbandonedDraftsBatch(cutoff, 2);
    const third = await contests.deleteAbandonedDraftsBatch(cutoff, 2);

    expect([first.length, second.length, third.length]).toEqual([2, 2, 1]);
    expect(new Set([...first, ...second, ...third].map((draft) => draft.leagueId))).toEqual(new Set(leagues.map((league) => league.id)));
    expect(await remainingContestIds()).toEqual([]);
  });

  it('keeps a draft the commissioner opens while the cleanup waits on its row lock', async () => {
    const { league } = await seedLeagueWithTeams(0);
    const event = await eventStarted(100);
    const draft = await seedContest(league.id, ContestStatus.DRAFT, [event.id]);
    const prisma = getPrisma();

    const holder = holdContestLocks(prisma, [draft.id]);
    const holderPid = await holder.ready;
    const purged = retention().purge(new Date());
    await waitUntilBlockedBy(prisma, holderPid).finally(() =>
      holder.release((tx) => tx.contest.update({ where: { id: draft.id }, data: { status: ContestStatus.OPEN } })));

    expect(await purged).toBe(0);
    expect(await remainingContestIds()).toEqual([draft.id]);
    await expect(prisma.contestConfiguration.count({ where: { contestId: draft.id } })).resolves.toBe(1);
  });

  it('keeps a draft the commissioner gives an upcoming event while the cleanup waits on its row lock', async () => {
    const { league } = await seedLeagueWithTeams(0);
    const old = await eventStarted(100);
    const upcoming = (await seedEventWithField(0, { startsInDays: 7 })).event;
    const draft = await seedContest(league.id, ContestStatus.DRAFT, [old.id]);
    const prisma = getPrisma();

    const holder = holdContestLocks(prisma, [draft.id]);
    const holderPid = await holder.ready;
    const purged = retention().purge(new Date());
    // The swap `replaceSportEvents` makes under the same lock: the old event out, the new one in.
    await waitUntilBlockedBy(prisma, holderPid).finally(() =>
      holder.release(async (tx) => {
        await tx.contestSportEvent.deleteMany({ where: { contestId: draft.id } });
        await tx.contestSportEvent.create({ data: { contestId: draft.id, sportEventId: upcoming.id, sequence: 1 } });
      }));

    expect(await purged).toBe(0);
    expect(await remainingContestIds()).toEqual([draft.id]);
  });
});

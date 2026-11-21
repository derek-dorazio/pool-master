/**
 * #1949 — contests move through the one contest writer, `ContestLifecycle`, and the league's
 * emails follow from the handler map as jobs written with the move (settlement's final results
 * job is checked in contest-settlement.integration.ts). An event's start can take
 * hundreds of contests live at once, so the handlers read nothing per contest: the same
 * statements go to the database for 2 contests as for 20 (`rules/testing-rules.md` §9B).
 */
import { BackgroundJobType, ContestStatus, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import { createEventLifecycleService } from '../../../packages/core-api/src/modules/events/wiring';
import { PrismaSportEventRepository } from '../../../packages/core-api/src/adapters';
import { testDomainEvents } from '../../support/domain-events';
import { expectDefined } from '../../support/expect-defined';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  integrationBackgroundJobs,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { seedEventWithField, seedLeagueWithTeams } from '../list-route-seeds';
import { expectSameStatementCount } from '../query-scaling';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

/** An event under way with `contests` open contests on it, each in a league of its own, so a read per league shows too. */
async function seedOpenContests(contests: number, { status = ContestStatus.OPEN }: { status?: ContestStatus } = {}) {
  const prisma = getPrisma();
  const seeded = await seedEventWithField(0, { startsInDays: -1, status: SportEventStatus.IN_PROGRESS });
  // The event as the lifecycle reads it, the domain shape rather than the row.
  const event = expectDefined(await new PrismaSportEventRepository(getAppPrisma()).findById(seeded.event.id));
  const contestIds: string[] = [];
  for (let index = 0; index < contests; index += 1) {
    const { league, suffix } = await seedLeagueWithTeams(0);
    const contest = await prisma.contest.create({
      data: {
        leagueId: league.id,
        seasonYear: event.startDate.getUTCFullYear(),
        sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        name: `Lifecycle ${suffix}`,
        status,
        contestFormat: 'ROSTER',
        selectionType: SelectionType.TIERED,
      },
    });
    contestIds.push(contest.id);
  }
  return { event, contestIds };
}

function jobsOf(type: BackgroundJobType, contestIds: readonly string[]) {
  return getPrisma().backgroundJob.findMany({ where: { type, dedupeKey: { in: contestIds.map((contestId) => `${type}:${contestId}`) } } });
}

function lifecycle() {
  const { queue } = integrationBackgroundJobs();
  return createEventLifecycleService(getAppPrisma(), { domainEvents: testDomainEvents({ queue }) });
}

describe('ContestLifecycle through the event lifecycle', () => {
  it('takes every open contest on a started event live and writes one "Contest is live" job per contest with the move', async () => {
    const { event, contestIds } = await seedOpenContests(3);

    await lifecycle().activateContestsPastCutoff(event);

    const contests = await getPrisma().contest.findMany({ where: { id: { in: contestIds } } });
    expect(contests.map((contest) => contest.status)).toEqual(contestIds.map(() => ContestStatus.ACTIVE));
    const jobs = await jobsOf(BackgroundJobType.CONTEST_STARTED_EMAILS, contestIds);
    expect(jobs.map((job) => job.payload).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
      .toEqual(contestIds.map((contestId) => ({ contestId, sportEventId: event.id })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  });

  it('writes no job for a contest another caller already took live, so a second sweep tells nobody twice', async () => {
    const { event, contestIds } = await seedOpenContests(2, { status: ContestStatus.ACTIVE });

    await lifecycle().activateContestsPastCutoff(event);

    expect(await jobsOf(BackgroundJobType.CONTEST_STARTED_EMAILS, contestIds)).toEqual([]);
  });

  it('costs the same statements to take 2 contests live as 20: the handlers read nothing per contest', async () => {
    await expectSameStatementCount({
      seed: (rows) => seedOpenContests(rows),
      call: async ({ event, contestIds }) => {
        await lifecycle().activateContestsPastCutoff(event);
        return getPrisma().contest.count({ where: { id: { in: contestIds }, status: ContestStatus.ACTIVE } });
      },
      rowsShown: (moved) => moved,
    });
  });
});


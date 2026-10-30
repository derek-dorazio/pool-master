import { randomUUID } from 'node:crypto';
import {
  ContestFormat,
  ContestStatus,
  LeagueMembershipStatus,
  LeagueRole,
  SelectionType,
  Sport,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import {
  PrismaContestConfigurationRepository,
  PrismaContestRepository,
  PrismaMembershipTransaction,
  PrismaSportEventRepository,
  PrismaSportLeagueRepository,
  PrismaSquadMembershipRepository,
} from '../../../packages/core-api/src/adapters';
import { runWithReadMemo } from '../../../packages/core-api/src/core/request-read-memo';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { createContestRow } from '../../support/contest-rows';
import { freshEventEdition } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';

// The request read memo over the contest, configuration, team membership, sport event and sport
// league reads against Postgres (#1200): within one request each row is read once and shared, a
// write through the repository is seen by the next read in the same request, and a row created
// after a read that found nothing is found.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
});

function repos() {
  return {
    contests: new PrismaContestRepository(getAppPrisma()),
    configurations: new PrismaContestConfigurationRepository(getAppPrisma()),
    squadMemberships: new PrismaSquadMembershipRepository(getAppPrisma()),
    sportEvents: new PrismaSportEventRepository(getAppPrisma()),
    sportLeagues: new PrismaSportLeagueRepository(getAppPrisma()),
  };
}

/** A league with its commissioner, one team, one golf event and a draft contest on it. */
async function seed() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const { user } = await createTestUser({ displayName: `Memo ${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Memo Cup', leagueCode: `MEMC${suffix}`, name: `Memo ${suffix}` } });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: user.id, role: LeagueRole.COMMISSIONER, status: LeagueMembershipStatus.ACTIVE },
  });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, createdBy: user.id, name: `Memo Team ${suffix}` } });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `memo-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Memo Open ${suffix}`,
      startDate: new Date('2026-06-04T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const contest = await createContestRow(repos().contests, {
    leagueId: league.id, seasonYear: 2026, sportEventIds: [event.id], name: `Memo Contest ${suffix}`,
    status: ContestStatus.DRAFT, contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED,
  });
  return { user, league, squad, event, contest };
}

describe('request read memo over contests, teams and events (#1200)', () => {
  it('reads each row once per request and shares it, and reads afresh in the next request', async () => {
    const { user, league, event, contest } = await seed();
    const { contests, squadMemberships, sportEvents, sportLeagues } = repos();

    const read = () => runWithReadMemo(async () => {
      const firstEvent = expectDefined(await sportEvents.findById(event.id));
      const first = {
        contest: await contests.findById(contest.id),
        team: await squadMemberships.findByLeagueAndUser(league.id, user.id),
        event: firstEvent,
        sportLeague: await sportLeagues.findById(firstEvent.sportLeagueId),
      };
      const again = {
        contest: await contests.findById(contest.id),
        team: await squadMemberships.findByLeagueAndUser(league.id, user.id),
        event: await sportEvents.findById(event.id),
        sportLeague: await sportLeagues.findById(firstEvent.sportLeagueId),
      };
      return { first, again };
    });
    const one = await read();
    const next = await read();

    expect(one.again.contest).toBe(one.first.contest);
    expect(one.again.event).toBe(one.first.event);
    expect(one.again.sportLeague).toBe(one.first.sportLeague);
    expect(one.first.sportLeague).not.toBeNull();
    expect(one.first.team).toBeNull();
    expect(next.first.contest).not.toBe(one.first.contest);
    expect(next.first.contest).toEqual(one.first.contest);
  });

  it('answers a point read from a batch read of the same events, and loads only the events not read yet', async () => {
    const { event } = await seed();
    const { sportEvents } = repos();

    const { batch, point } = await runWithReadMemo(async () => {
      const batch = await sportEvents.findByIds([event.id, randomUUID()]);
      return { batch, point: await sportEvents.findById(event.id) };
    });

    expect(batch.map((row) => row.id)).toEqual([event.id]);
    expect(point).toBe(batch[0]);
  });

  it('sees writes made earlier in the same request through the repositories', async () => {
    const { contest, event } = await seed();
    const { contests, sportEvents, sportLeagues } = repos();
    const renamed = `Renamed Open ${randomUUID().slice(0, 4)}`;

    const after = await runWithReadMemo(async () => {
      const before = expectDefined(await sportEvents.findById(event.id));
      await contests.findById(contest.id);
      await sportLeagues.findById(before.sportLeagueId);
      await contests.transitionStatus(contest.id, { from: [ContestStatus.DRAFT], to: ContestStatus.OPEN, openedAt: new Date() });
      await sportEvents.update(event.id, { name: renamed });
      await sportLeagues.update(before.sportLeagueId, { isActive: false });
      return {
        contest: await contests.findById(contest.id),
        event: await sportEvents.findById(event.id),
        sportLeague: await sportLeagues.findById(before.sportLeagueId),
      };
    });

    expect(after.contest?.status).toBe(ContestStatus.OPEN);
    expect(after.event?.name).toBe(renamed);
    expect(after.sportLeague?.isActive).toBe(false);
  });

  it('finds a configuration and a team membership created after a read in the same request found none', async () => {
    const { user, league, squad, contest } = await seed();
    const { configurations, squadMemberships } = repos();

    const after = await runWithReadMemo(async () => {
      const before = {
        configuration: await configurations.findByContest(contest.id),
        team: await squadMemberships.findByLeagueAndUser(league.id, user.id),
      };
      await configurations.create({ contestId: contest.id, selectionType: SelectionType.TIERED });
      await squadMemberships.create({
        squadId: squad.id, leagueId: league.id, userId: user.id, status: SquadMembershipStatus.ACTIVE, joinedAt: new Date(),
      });
      return {
        before,
        configuration: await configurations.findByContest(contest.id),
        team: await squadMemberships.findByLeagueAndUser(league.id, user.id),
      };
    });

    expect(after.before).toEqual({ configuration: null, team: null });
    expect(after.configuration?.contestId).toBe(contest.id);
    expect(after.team?.squadId).toBe(squad.id);
  });

  it('reads no contest and no configuration after the request deletes the contest', async () => {
    const { contest } = await seed();
    const { contests, configurations } = repos();
    await configurations.create({ contestId: contest.id, selectionType: SelectionType.TIERED });

    const after = await runWithReadMemo(async () => {
      await contests.findById(contest.id);
      await configurations.findByContest(contest.id);
      await contests.delete(contest.id);
      return { contest: await contests.findById(contest.id), configuration: await configurations.findByContest(contest.id) };
    });

    expect(after).toEqual({ contest: null, configuration: null });
  });

  it('forgets a team membership read during a membership transaction once the transaction commits', async () => {
    const { user, league, squad } = await seed();
    const { squadMemberships } = repos();
    const membership = await squadMemberships.create({
      squadId: squad.id, leagueId: league.id, userId: user.id, status: SquadMembershipStatus.ACTIVE, joinedAt: new Date(),
    });

    const after = await runWithReadMemo(async () => {
      await new PrismaMembershipTransaction(getAppPrisma()).run(async (txRepos) => {
        await txRepos.squadMemberships.update(membership.id, { status: SquadMembershipStatus.INACTIVE });
        // Outside the transaction, so it sees the row as it was before the write.
        await squadMemberships.findByLeagueAndUser(league.id, user.id);
      });
      return squadMemberships.findByLeagueAndUser(league.id, user.id);
    });

    expect(after?.status).toBe(SquadMembershipStatus.INACTIVE);
  });
});

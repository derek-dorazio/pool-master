/**
 * #1255, #1336 — the batch reads the notification sweeps and the event-changed email use in place
 * of a read per event, league, contest or person, against real Postgres: each answers for every id
 * named in one read, and the same rows the one-id read answers for each.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ContestStatus, LeagueRole, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import {
  PrismaContestEntryRepository,
  PrismaContestEntryStandingRepository,
  PrismaContestRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaSquadMembershipRepository,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { expectDefined } from '../../support/expect-defined';
import { cleanupTestData, createTestUser, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, seedFootballWeek, seedLeagueWithTeams } from '../list-route-seeds';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const nextMonth = () => seedFootballWeek({ games: 1, startDate: new Date(Date.now() + 30 * DAY), status: SportEventStatus.SCHEDULED });

async function contestOn(leagueId: string, sportEventIds: readonly string[], status: ContestStatus = ContestStatus.OPEN) {
  return getPrisma().contest.create({
    data: {
      leagueId,
      seasonYear: 2026,
      sportEvents: { create: sportEventIds.map((sportEventId, index) => ({ sportEventId, sequence: index + 1 })) },
      name: `Batch ${randomUUID().slice(0, 8)}`,
      status,
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.PICK_EM,
    },
  });
}

describe('notification batch reads (#1255)', () => {
  it('reads the contests on several events once each, oldest first, leaving out other events\' contests', async () => {
    const { league } = await seedLeagueWithTeams(0);
    const [first, second, other] = await Promise.all([nextMonth(), nextMonth(), nextMonth()]);
    const onFirst = await contestOn(league.id, [first.event.id]);
    const season = await contestOn(league.id, [first.event.id, second.event.id]);
    const draft = await contestOn(league.id, [second.event.id], ContestStatus.DRAFT);
    await contestOn(league.id, [other.event.id]);
    const contests = new PrismaContestRepository(getPrisma());

    const all = await contests.findBySportEvents([first.event.id, second.event.id]);

    expect(all.map((contest) => contest.id)).toEqual([onFirst.id, season.id, draft.id]);
    expect(expectDefined(all.find((contest) => contest.id === season.id)).sportEventIds).toEqual([first.event.id, second.event.id]);
    await expect(contests.findBySportEvents([])).resolves.toEqual([]);
  });

  it('reads several leagues by id, leaving out an id with no league', async () => {
    const [first, second] = await Promise.all([seedLeagueWithTeams(0), seedLeagueWithTeams(0)]);
    const leagues = new PrismaLeagueRepository(getPrisma());

    const found = await leagues.findByIds([first.league.id, second.league.id, randomUUID()]);

    expect(found.map((league) => league.id).sort()).toEqual([first.league.id, second.league.id].sort());
    await expect(leagues.findByIds([])).resolves.toEqual([]);
  });

  it('reads several leagues\' active members and their users in one read each, leaving out a removed member and other leagues', async () => {
    const prisma = getPrisma();
    const [first, second, other] = await Promise.all([seedLeagueWithTeams(1), seedLeagueWithTeams(0), seedLeagueWithTeams(1)]);
    const both = await createTestUser({ firstName: 'Avery', lastName: 'Aardvark' });
    const removed = await createTestUser({ firstName: 'Riley', lastName: 'Removed' });
    await prisma.leagueMembership.createMany({
      data: [
        { leagueId: first.league.id, userId: both.user.id, role: 'MEMBER', status: 'ACTIVE' },
        { leagueId: second.league.id, userId: both.user.id, role: 'COMMISSIONER', status: 'ACTIVE' },
        { leagueId: second.league.id, userId: removed.user.id, role: 'MEMBER', status: 'INACTIVE' },
      ],
    });
    const memberships = new PrismaLeagueMembershipRepository(prisma);
    const users = new PrismaUserRepository(prisma);
    const leagueIds = [first.league.id, second.league.id];

    const rows = await memberships.findByLeagues(leagueIds);
    const members = await users.findActiveByLeagues(leagueIds);

    const expectedRows = (await Promise.all(leagueIds.map((leagueId) => memberships.findByLeague(leagueId)))).flat();
    expect(rows.map((row) => row.id).sort()).toEqual(expectedRows.map((row) => row.id).sort());
    expect(rows.some((row) => row.userId === removed.user.id)).toBe(false);
    const firstMembers = await users.findActiveByLeague(first.league.id);
    const secondMembers = await users.findActiveByLeague(second.league.id);
    expect(members.map((user) => user.id).sort()).toEqual([...new Set([...firstMembers, ...secondMembers].map((user) => user.id))].sort());
    expect(members.at(0)?.id).toBe(both.user.id);
    expect(members.some((user) => user.id === other.commissioner.user.id)).toBe(false);
    await expect(memberships.findByLeagues([])).resolves.toEqual([]);
    await expect(users.findActiveByLeagues([])).resolves.toEqual([]);
  });

  it('reads several contests\' entries in creation order, leaving out other contests', async () => {
    const prisma = getPrisma();
    const { league, squads } = await seedLeagueWithTeams(2);
    const { event } = await nextMonth();
    const [first, second, other] = await Promise.all([contestOn(league.id, [event.id]), contestOn(league.id, [event.id]), contestOn(league.id, [event.id])]);
    const squad = (index: number) => expectDefined(squads[index]).id;
    const firstEntry = await prisma.contestEntry.create({ data: { contestId: first.id, squadId: squad(0), entryNumber: 1, name: 'First' } });
    const secondEntry = await prisma.contestEntry.create({ data: { contestId: second.id, squadId: squad(1), entryNumber: 1, name: 'Second' } });
    await prisma.contestEntry.create({ data: { contestId: other.id, squadId: squad(0), entryNumber: 1, name: 'Other' } });
    const entries = new PrismaContestEntryRepository(prisma);

    const found = await entries.findByContests([second.id, first.id]);

    expect(found.map((entry) => entry.id)).toEqual([firstEntry.id, secondEntry.id]);
    await expect(entries.findByContests([])).resolves.toEqual([]);
  });
});

describe('notification batch reads (#1336)', () => {
  it('reads only the commissioners of several leagues, memberships and users alike, when asked for that role', async () => {
    const prisma = getPrisma();
    const [first, second] = await Promise.all([seedLeagueWithTeams(2), seedLeagueWithTeams(1)]);
    const coCommissioner = await createTestUser({ firstName: 'Cory', lastName: 'Co' });
    await prisma.leagueMembership.create({ data: { leagueId: second.league.id, userId: coCommissioner.user.id, role: 'COMMISSIONER', status: 'ACTIVE' } });
    const leagueIds = [first.league.id, second.league.id];
    const commissionerIds = [first.commissioner.user.id, second.commissioner.user.id, coCommissioner.user.id].sort();

    const memberships = await new PrismaLeagueMembershipRepository(prisma).findByLeagues(leagueIds, [LeagueRole.COMMISSIONER]);
    const users = await new PrismaUserRepository(prisma).findActiveByLeagues(leagueIds, [LeagueRole.COMMISSIONER]);

    expect(memberships.map((row) => row.userId).sort()).toEqual(commissionerIds);
    expect(memberships.every((row) => row.role === LeagueRole.COMMISSIONER)).toBe(true);
    expect(users.map((user) => user.id).sort()).toEqual(commissionerIds);
  });

  it('reads several people\'s squads with their names in one read, each in their own league, not a squad they hold in another league', async () => {
    const prisma = getPrisma();
    const [first, second] = await Promise.all([seedLeagueWithTeams(2), seedLeagueWithTeams(1)]);
    const owner = async (squad: { id: string }) => (await prisma.squadMembership.findFirstOrThrow({ where: { squadId: squad.id } })).userId;
    const [firstOwner, secondOwner, otherOwner] = await Promise.all([
      owner(expectDefined(first.squads[0])),
      owner(expectDefined(first.squads[1])),
      owner(expectDefined(second.squads[0])),
    ]);
    const squadMemberships = new PrismaSquadMembershipRepository(prisma);
    // The other league's owner asked for in the first league, where they have no squad: crossing
    // the leagues with the people would find their squad in the other league.
    const people = [
      { leagueId: first.league.id, userId: firstOwner },
      { leagueId: first.league.id, userId: otherOwner },
      { leagueId: second.league.id, userId: secondOwner },
      { leagueId: second.league.id, userId: otherOwner },
      { leagueId: first.league.id, userId: first.commissioner.user.id },
    ];

    const found = await squadMemberships.findByLeagueUsersWithSquadName(people);

    const expected = (await Promise.all(people.map(({ leagueId, userId }) => squadMemberships.findByLeagueAndUserWithSquadName(leagueId, userId))))
      .flatMap((row) => (row ? [{ leagueId: row.leagueId, userId: row.userId, squadName: row.squadName }] : []));
    const byKey = (rows: Array<{ leagueId: string; userId: string }>) => rows.map(({ leagueId, userId }) => `${leagueId}:${userId}`).sort();
    expect(byKey(found)).toEqual(byKey(expected));
    expect(found.map(({ leagueId, userId, squadName }) => ({ leagueId, userId, squadName })))
      .toEqual(expect.arrayContaining(expected));
    expect(found).toHaveLength(2);
    await expect(squadMemberships.findByLeagueUsersWithSquadName([])).resolves.toEqual([]);
  });

  it('reads the first-place entries of several contests in one read, ties in entry number then name order, leaving out other places and contests', async () => {
    const prisma = getPrisma();
    const { league, squads } = await seedLeagueWithTeams(3);
    const { event } = await nextMonth();
    const [tied, single, other] = await Promise.all([
      contestOn(league.id, [event.id], ContestStatus.COMPLETED),
      contestOn(league.id, [event.id], ContestStatus.COMPLETED),
      contestOn(league.id, [event.id], ContestStatus.COMPLETED),
    ]);
    const squad = (index: number) => expectDefined(squads[index]).id;
    const place = async (contestId: string, squadIndex: number, entryNumber: number, name: string, position: number) => {
      const entry = await prisma.contestEntry.create({ data: { contestId, squadId: squad(squadIndex), entryNumber, name } });
      await prisma.contestEntryStanding.create({
        data: { contestId, contestEntryId: entry.id, position, displayPosition: String(position), countingPickLimit: 0, scoredPickCount: 0, settledAt: new Date() },
      });
    };
    await place(tied.id, 0, 2, 'Azalea', 1);
    await place(tied.id, 1, 1, 'Magnolia', 1);
    await place(tied.id, 2, 1, 'Dogwood', 1);
    await place(tied.id, 0, 1, 'Amen Corner', 4);
    await place(single.id, 0, 1, 'Green Jackets', 1);
    await place(single.id, 1, 1, 'Runners-up', 2);
    await place(other.id, 0, 1, 'Elsewhere', 1);
    const standings = new PrismaContestEntryStandingRepository(prisma);

    const winners = await standings.findWinnersByContests([tied.id, single.id]);

    expect(winners.filter((winner) => winner.contestId === tied.id).map((winner) => winner.entryName)).toEqual(['Dogwood', 'Magnolia', 'Azalea']);
    expect(winners.filter((winner) => winner.contestId === single.id).map((winner) => winner.entryName)).toEqual(['Green Jackets']);
    expect(winners).toHaveLength(4);
    await expect(standings.findWinnersByContests([])).resolves.toEqual([]);
  });
});

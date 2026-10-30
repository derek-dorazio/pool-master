/**
 * #1255 — the batch reads the notification sweeps and the event-changed email use in place of a
 * read per event, league or contest, against real Postgres: each answers for every id named in
 * one read, and the same rows the one-id read answers for each.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ContestStatus, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import {
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaEmailMessageRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
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

  it('reads the leagues recorded under several key prefixes in one read, by prefix, with an empty set for a prefix nothing is under', async () => {
    const [first, second] = await Promise.all([seedLeagueWithTeams(0), seedLeagueWithTeams(0)]);
    const outbox = new PrismaEmailMessageRepository(getPrisma());
    const suffix = randomUUID().slice(0, 8);
    const record = (templateKey: 'LEAGUE_MEMBER_JOINED' | 'EVENT_COMING_UP', leagueId: string, about: string, user: string) => outbox.record({
      templateKey,
      leagueId,
      recipientEmail: `${user}-${suffix}@integration.test`,
      idempotencyKey: `${templateKey}:${about}:${user}-${suffix}`,
      fromName: 'Batch League',
      fromAddress: 'league@integration.test',
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
    });
    await record('LEAGUE_MEMBER_JOINED', first.league.id, 'join-a', 'casey');
    await record('LEAGUE_MEMBER_JOINED', first.league.id, 'join-a', 'jordan');
    await record('LEAGUE_MEMBER_JOINED', second.league.id, 'join-b', 'casey');
    await record('EVENT_COMING_UP', second.league.id, 'join-c', 'casey');
    const prefixes = ['LEAGUE_MEMBER_JOINED:join-a:', 'LEAGUE_MEMBER_JOINED:join-b:', 'LEAGUE_MEMBER_JOINED:join-c:'];

    const recorded = await outbox.findLeagueIdsRecordedByPrefix({ templateKey: 'LEAGUE_MEMBER_JOINED', keyPrefixes: prefixes });

    expect(recorded).toEqual(new Map([
      ['LEAGUE_MEMBER_JOINED:join-a:', new Set([first.league.id])],
      ['LEAGUE_MEMBER_JOINED:join-b:', new Set([second.league.id])],
      ['LEAGUE_MEMBER_JOINED:join-c:', new Set()],
    ]));
    for (const keyPrefix of prefixes) {
      expect(recorded.get(keyPrefix)).toEqual(await outbox.findLeagueIdsRecorded({ templateKey: 'LEAGUE_MEMBER_JOINED', keyPrefix }));
    }
    await expect(outbox.findLeagueIdsRecordedByPrefix({ templateKey: 'LEAGUE_MEMBER_JOINED', keyPrefixes: [] })).resolves.toEqual(new Map());
  });
});

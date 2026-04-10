import {
  createContest,
  deleteContest,
  enterContest,
  getContest,
  getMyContestEntry,
  leaveContest,
  listContestEntries,
  listContests,
} from '@poolmaster/shared/generated/hey-api';
import { ContestType, ScoringEngine, SelectionType } from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Contests and Entries', () => {
  it('creates, lists, and reads a contest through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Contest Commissioner',
      leagueName: 'Contest Functional League',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Functional Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    expect(createResponse.data).toBeDefined();
    expect(createResponse.data?.contest.name).toBe('Functional Contest');
    expect(createResponse.data?.contest.leagueId).toBe(league.id);
    expect(createResponse.data?.contest.status).toBe('DRAFT');
    expect(createResponse.data?.contest.selectionType).toBe('BUDGET_PICK');
    expect(createResponse.data?.contest.scoringEngine).toBe('POSITION');

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const listResponse = await listContests({
      client: commissioner.client,
      path: {
        id: league.id,
      },
    });

    expect(listResponse.data).toBeDefined();
    const listedContest = listResponse.data?.contests.find((contest) => contest.id === contestId);
    expect(listedContest).toBeDefined();
    expect(listedContest?.name).toBe('Functional Contest');
    expect(listedContest?.status).toBe('DRAFT');

    const detailResponse = await getContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(detailResponse.data).toBeDefined();
    expect(detailResponse.data?.contest.id).toBe(contestId);
    expect(detailResponse.data?.contest.name).toBe('Functional Contest');
    expect(detailResponse.data?.contest.status).toBe('DRAFT');

    const deleteResponse = await deleteContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(deleteResponse.response.status).toBe(204);

    const deletedContest = await getContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expectFunctionalError(deletedContest, {
      status: 404,
      code: 'CONTEST_NOT_FOUND',
    });
  });

  it('creates, enters, lists, leaves, and re-enters a contest through the generated SDK', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Entry Commissioner',
      leagueName: 'Entry Functional League',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Entry Lifecycle Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const enterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(enterResponse.data).toBeDefined();
    expect(enterResponse.data?.contestId).toBe(contestId);
    expect(enterResponse.data?.entry.status).toBe('ACTIVE');
    expect(enterResponse.data?.entry.totalScore).toBe(0);
    expect(enterResponse.data?.entry.entryNumber).toBe(1);

    const myEntryResponse = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(myEntryResponse.data).toBeDefined();
    expect(myEntryResponse.data?.contestId).toBe(contestId);
    expect(myEntryResponse.data?.entry?.id).toBe(enterResponse.data?.entry.id);

    const entriesResponse = await listContestEntries({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(entriesResponse.data).toBeDefined();
    expect(entriesResponse.data?.contestId).toBe(contestId);
    expect(entriesResponse.data?.isJoined).toBe(true);
    expect(entriesResponse.data?.myEntryId).toBe(enterResponse.data?.entry.id);
    expect(entriesResponse.data?.entries).toHaveLength(1);

    const leaveResponse = await leaveContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(leaveResponse.data).toBeDefined();
    expect(leaveResponse.data?.contestId).toBe(contestId);
    expect(leaveResponse.data?.deleted).toBe(true);

    const afterLeaveMyEntry = await getMyContestEntry({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(afterLeaveMyEntry.data).toBeDefined();
    expect(afterLeaveMyEntry.data?.contestId).toBe(contestId);
    expect(afterLeaveMyEntry.data?.entry).toBeNull();

    const afterLeaveEntries = await listContestEntries({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(afterLeaveEntries.data).toBeDefined();
    expect(afterLeaveEntries.data?.isJoined).toBe(false);
    expect(afterLeaveEntries.data?.entries).toHaveLength(0);
    expect(afterLeaveEntries.data?.myEntryId).toBeNull();

    const reenterResponse = await enterContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(reenterResponse.data).toBeDefined();
    expect(reenterResponse.data?.contestId).toBe(contestId);
    expect(reenterResponse.data?.entry.status).toBe('ACTIVE');
    expect(reenterResponse.data?.entry.entryNumber).toBe(1);

    const cleanupDeleteResponse = await deleteContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(cleanupDeleteResponse.response.status).toBe(204);

    const deletedContest = await getContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expectFunctionalError(deletedContest, {
      status: 404,
      code: 'CONTEST_NOT_FOUND',
    });
  });

  it('rejects a league outsider from entering a contest', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({
      displayName: 'Outsider Commissioner',
      leagueName: 'Outsider Functional League',
    });
    const outsider = await buildRegisteredUser({
      displayName: 'Contest Outsider',
    });

    const createResponse = await createContest({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Outsider Contest',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.BUDGET_PICK,
        scoringEngine: ScoringEngine.POSITION,
      },
    });

    const contestId = createResponse.data?.contest.id;
    expect(contestId).toBeTruthy();

    const enterResponse = await enterContest({
      client: outsider.client,
      path: {
        contestId: contestId as string,
      },
    });

    expectFunctionalError(enterResponse, {
      status: 400,
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });

    const cleanupDeleteResponse = await deleteContest({
      client: commissioner.client,
      path: {
        contestId: contestId as string,
      },
    });

    expect(cleanupDeleteResponse.response.status).toBe(204);
  });
});

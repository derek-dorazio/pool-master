/**
 * CRUD-style integration coverage for the contest entry lifecycle.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner user
 * - creates its own league and contest
 * - creates the current user's contest entry
 * - lists entries
 * - fetches the current user's entry
 * - deletes the entry
 * - verifies the entry is gone
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  ContestStatus,
  ContestType,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest Entry CRUD Integration', () => {
  let ownerHeaders: Record<string, string>;
  let ownerDisplayName: string;
  let leagueId: string;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Contest Entry CRUD Owner' });
    ownerHeaders = owner.headers;
    ownerDisplayName = owner.user.displayName;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Contest Entry CRUD League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Contest Entry CRUD Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        selectionConfig: {
          rounds: 6,
          tierAssignmentMethod: 'AUTO_ODDS',
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 2,
              participantIds: [],
            },
          ],
        },
      },
    });

    expect(contestRes.statusCode).toBe(201);
    const contest = contestRes.json().contest ?? contestRes.json();
    contestId = contest.id;
    expect(contest.status).toBe(ContestStatus.DRAFT);
  });

  it('creates, lists, fetches, deletes, and verifies deletion of the current user contest entry', async () => {
    const createEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect([200, 201]).toContain(createEntryRes.statusCode);
    const createdEntry = createEntryRes.json().entry;
    expect(createEntryRes.json().contestId).toBe(contestId);
    expect(createdEntry.contestId).toBe(contestId);
    expect(createdEntry.squadName).toBe(`${ownerDisplayName}'s Squad`);
    expect(createdEntry.entryNumber).toBe(1);
    expect(createdEntry.name).toBe(`${ownerDisplayName}'s Squad Entry 1`);

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contests.entries(contestId),
      headers: ownerHeaders,
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().contestId).toBe(contestId);
    expect(listRes.json().isJoined).toBe(true);
    expect(listRes.json().myEntryId).toBe(createdEntry.id);
    expect(listRes.json().myEntryIds).toContain(createdEntry.id);
    expect(listRes.json().total).toBeGreaterThanOrEqual(1);
    expect(
      listRes.json().entries.some((entry: { id: string }) => entry.id === createdEntry.id),
    ).toBe(true);

    const myEntryRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: ownerHeaders,
    });

    expect(myEntryRes.statusCode).toBe(200);
    expect(myEntryRes.json().contestId).toBe(contestId);
    expect(myEntryRes.json().entry?.id).toBe(createdEntry.id);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({
      contestId,
      deleted: true,
    });

    const afterDeleteRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: ownerHeaders,
    });

    expect(afterDeleteRes.statusCode).toBe(200);
    expect(afterDeleteRes.json()).toEqual({
      contestId,
      entry: null,
    });
  });
});

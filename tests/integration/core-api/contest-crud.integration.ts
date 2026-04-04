/**
 * CRUD-style integration coverage for the core contest lifecycle.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner user
 * - creates its own league
 * - creates its own contest
 * - updates the contest
 * - deletes the contest
 * - verifies the contest is gone
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

describe('Contest CRUD Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Contest CRUD Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Contest CRUD League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;
  });

  it('creates, lists, fetches, updates, deletes, and verifies deletion of a contest', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Contest CRUD Pool',
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
            {
              tierId: 'tier-2',
              tierName: 'Tier 2',
              tierNumber: 2,
              picksFromTier: 2,
              participantIds: [],
            },
          ],
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json().contest ?? createRes.json();
    contestId = createdContest.id;
    expect(createdContest.name).toBe('Contest CRUD Pool');
    expect(createdContest.status).toBe(ContestStatus.DRAFT);
    expect(createdContest.selectionType).toBe(SelectionType.TIERED);

    const listRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
    });

    expect(listRes.statusCode).toBe(200);
    const listedContests = Array.isArray(listRes.json()) ? listRes.json() : listRes.json().contests;
    expect(listedContests.some((contest: { id: string }) => contest.id === contestId)).toBe(true);

    const getRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contests.detail(contestId),
      headers: ownerHeaders,
    });

    expect(getRes.statusCode).toBe(200);
    const fetchedContest = getRes.json().contest ?? getRes.json();
    expect(fetchedContest.id).toBe(contestId);
    expect(fetchedContest.name).toBe('Contest CRUD Pool');

    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contests.detail(contestId),
      headers: ownerHeaders,
      payload: {
        name: 'Contest CRUD Pool Updated',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedContest = updateRes.json().contest ?? updateRes.json();
    expect(updatedContest.id).toBe(contestId);
    expect(updatedContest.name).toBe('Contest CRUD Pool Updated');

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.contests.detail(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect(deleteRes.statusCode).toBe(204);

    const afterDeleteRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contests.detail(contestId),
      headers: ownerHeaders,
    });

    expect(afterDeleteRes.statusCode).toBe(404);
  });
});

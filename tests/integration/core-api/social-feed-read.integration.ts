/**
 * Integration coverage for the league social feed read model.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner user and league
 * - creates feed posts through the real route
 * - reads feed pages through the real route
 * - reads a post with replies through the real route
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { LeagueVisibility } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Social Feed Read Integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let firstPostId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Feed Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Feed Read League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;
  });

  it('returns feed pages and a post with replies from the live social store', async () => {
    const firstPostRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/feed`,
      headers: ownerHeaders,
      payload: {
        content: 'First feed update',
        type: 'ANNOUNCEMENT',
      },
    });

    expect(firstPostRes.statusCode).toBe(201);
    firstPostId = firstPostRes.json().id;

    const secondPostRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/feed`,
      headers: ownerHeaders,
      payload: {
        content: 'Second feed update',
      },
    });

    expect(secondPostRes.statusCode).toBe(201);

    const feedRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/feed?limit=1`,
      headers: ownerHeaders,
    });

    expect(feedRes.statusCode).toBe(200);
    expect(feedRes.json().posts).toHaveLength(1);
    expect(feedRes.json().posts[0].content).toBe('Second feed update');
    expect(feedRes.json().nextCursor).toBe(secondPostRes.json().id);

    const pagedFeedRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/feed?cursor=${feedRes.json().nextCursor}&limit=1`,
      headers: ownerHeaders,
    });

    expect(pagedFeedRes.statusCode).toBe(200);
    expect(pagedFeedRes.json().posts).toHaveLength(1);
    expect(pagedFeedRes.json().posts[0].id).toBe(firstPostId);

    const replyRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/feed/${firstPostId}/replies`,
      headers: ownerHeaders,
      payload: {
        content: 'Reply on the first update',
      },
    });

    expect(replyRes.statusCode).toBe(201);
    expect(replyRes.json().parentId).toBe(firstPostId);

    const postRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/feed/${firstPostId}`,
      headers: ownerHeaders,
    });

    expect(postRes.statusCode).toBe(200);
    expect(postRes.json().id).toBe(firstPostId);
    expect(postRes.json().replies).toHaveLength(1);
    expect(postRes.json().replyCount).toBe(1);
  });
});

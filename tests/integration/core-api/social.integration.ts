/**
 * Integration: Social / Feed module — create posts, list feed, replies, reactions, delete.
 *
 * The social feed service is currently backed by in-memory storage (not Postgres),
 * but these tests exercise the real Fastify routes with a real test app instance.
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Social Feed Integration', () => {
  let headers: Record<string, string>;
  let leagueId: string;
  let postId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Feed User' });
    headers = user.headers;

    // Create a league to use for feed tests
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers,
      payload: {
        name: 'Feed Test League',
        visibility: 'PRIVATE',
        maxMembers: 10,
      },
    });
    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;
  });

  // ---- 1. Create a text post ----
  describe('POST /api/v1/leagues/:leagueId/feed', () => {
    it('creates a text post', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/feed`,
        headers,
        payload: { content: 'Hello league!' },
      });

      expect([200, 201]).toContain(res.statusCode);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.content).toBe('Hello league!');
      expect(body.leagueId).toBe(leagueId);
      expect(body.type).toBe('POST');
      postId = body.id;
    });
  });

  // ---- 2. List feed posts ----
  describe('GET /api/v1/leagues/:leagueId/feed', () => {
    it('returns feed with array of posts', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/feed`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.posts).toBeDefined();
      expect(Array.isArray(body.posts)).toBe(true);
      // Should contain the post we created plus seed posts
      expect(body.posts.length).toBeGreaterThanOrEqual(1);

      const userPost = body.posts.find((p: any) => p.id === postId);
      expect(userPost).toBeDefined();
      expect(userPost.content).toBe('Hello league!');
    });
  });

  // ---- 3. Add reaction ----
  describe('POST /api/v1/leagues/:leagueId/feed/:postId/reactions', () => {
    it('adds a reaction to a post', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/feed/${postId}/reactions`,
        headers,
        payload: { emoji: 'like' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.added).toBe(true);
    });
  });

  // ---- 4. Get post with replies (initially empty) ----
  describe('GET /api/v1/leagues/:leagueId/feed/:postId', () => {
    it('returns a post with its replies', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/feed/${postId}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(postId);
      expect(body.replies).toBeDefined();
      expect(Array.isArray(body.replies)).toBe(true);
    });
  });

  // ---- 5. Create reply ----
  describe('POST /api/v1/leagues/:leagueId/feed/:postId/replies', () => {
    it('creates a reply to a post', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/feed/${postId}/replies`,
        headers,
        payload: { content: 'Great post!' },
      });

      expect([200, 201]).toContain(res.statusCode);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.content).toBe('Great post!');
      expect(body.parentId).toBe(postId);
    });

    it('increments reply count on the parent post', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/feed/${postId}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.replyCount).toBeGreaterThanOrEqual(1);
      expect(body.replies.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- 6. Delete post ----
  describe('DELETE /api/v1/leagues/:leagueId/feed/:postId', () => {
    it('deletes a post', async () => {
      // Create a throwaway post to delete
      const createRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/feed`,
        headers,
        payload: { content: 'Delete me' },
      });
      expect([200, 201]).toContain(createRes.statusCode);
      const deleteTargetId = createRes.json().id;

      const res = await getApp().inject({
        method: 'DELETE',
        url: `/api/v1/leagues/${leagueId}/feed/${deleteTargetId}`,
        headers: {
          authorization: headers.authorization,
          // Strip content-type for DELETE
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });

      // Verify the post is gone
      const getRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/feed/${deleteTargetId}`,
        headers,
      });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ---- 7. Auth enforcement ----
  describe('Auth enforcement', () => {
    it('rejects POST feed without auth', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/feed`,
        payload: { content: 'No auth post' },
      });

      expect([400, 401]).toContain(res.statusCode);
    });
  });

  // ---- 8. Non-existent league feed ----
  describe('GET feed for non-existent league', () => {
    it('returns 200 with empty or seeded array for unknown league', async () => {
      const fakeLeagueId = '00000000-0000-0000-0000-000000000099';
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${fakeLeagueId}/feed`,
        headers,
      });

      // The in-memory feed service auto-seeds, so it returns 200 with posts
      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.posts).toBeDefined();
        expect(Array.isArray(body.posts)).toBe(true);
      }
    });
  });
});

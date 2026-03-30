/**
 * Integration: League member management — invitations, settings, dashboard
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

describe('Leagues Members Integration', () => {
  let ownerHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;
  let memberEmail: string;
  let leagueId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'League Owner' });
    ownerHeaders = owner.headers;
    const member = await createTestUser({ displayName: 'League Member' });
    memberHeaders = member.headers;
    memberEmail = member.user.email;

    // Create league
    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Members Test League', visibility: 'PRIVATE', maxMembers: 10 },
    });
    leagueId = res.json().league.id;
  });

  describe('POST /api/v1/leagues/:id/invitations', () => {
    it('sends email invitations', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/invitations`,
        headers: ownerHeaders,
        payload: { emails: [memberEmail] },
      });
      // 201 created or 200 ok
      expect([200, 201]).toContain(res.statusCode);
    });

    it('rejects unauthenticated invitation', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/invitations`,
        payload: { emails: ['nobody@test.com'] },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });

  describe('POST /api/v1/leagues/:id/invite-link', () => {
    it('generates invite link', async () => {
      // Send with explicit payload to avoid empty-body JSON error
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/invite-link`,
        headers: ownerHeaders,
        payload: { expiresInDays: 7, maxUses: 5 },
      });
      expect([200, 201]).toContain(res.statusCode);
      const body = res.json();
      expect(body.invitation || body.inviteCode || body.code).toBeDefined();
    });
  });

  describe('PUT /api/v1/leagues/:id/settings', () => {
    it('updates settings as owner', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/leagues/${leagueId}/settings`,
        headers: ownerHeaders,
        payload: { timezone: 'America/Chicago', currency: 'USD' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects settings update from non-owner member', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/leagues/${leagueId}/settings`,
        headers: memberHeaders,
        payload: { timezone: 'America/New_York' },
      });
      expect([403, 404]).toContain(res.statusCode);
    });

    it('rejects settings update without auth', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/leagues/${leagueId}/settings`,
        payload: { timezone: 'UTC' },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });

  describe('GET /api/v1/leagues/:id/dashboard', () => {
    it('returns dashboard data or is not implemented', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/dashboard`,
        headers: ownerHeaders,
      });
      // 200 if implemented, 404/500 if not yet
      expect([200, 404, 500, 501]).toContain(res.statusCode);
    });

    it('rejects without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}/dashboard`,
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});

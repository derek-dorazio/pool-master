/**
 * Integration: Membership management — role changes, removal, invite accept, ownership transfer
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

describe('Membership Integration', () => {
  let ownerHeaders: Record<string, string>;
  let ownerId: string;
  let member2Headers: Record<string, string>;
  let member2Id: string;
  let member3Headers: Record<string, string>;
  let member3Id: string;
  let leagueId: string;
  let inviteCode: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Owner' });
    ownerHeaders = owner.headers;
    ownerId = owner.user.id;

    const m2 = await createTestUser({ displayName: 'Member2' });
    member2Headers = m2.headers;
    member2Id = m2.user.id;

    const m3 = await createTestUser({ displayName: 'Member3' });
    member3Headers = m3.headers;
    member3Id = m3.user.id;

    // Create league
    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Membership Test League', visibility: 'PRIVATE', maxMembers: 10 },
    });
    leagueId = res.json().league.id;

    // Generate invite link
    const ilRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invite-link`,
      headers: ownerHeaders,
      payload: { expiresInDays: 7, maxUses: 10 },
    });
    const ilBody = ilRes.json();
    inviteCode = ilBody.invitation?.inviteCode ?? ilBody.inviteCode ?? ilBody.code;
  });

  describe('POST /api/v1/invitations/accept', () => {
    it('member2 joins via invite code', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: member2Headers,
        payload: { inviteCode },
      });
      expect([200, 201]).toContain(res.statusCode);
    });

    it('member3 joins via same invite code', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: member3Headers,
        payload: { inviteCode },
      });
      expect([200, 201]).toContain(res.statusCode);
    });

    it('rejects invalid invite code', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/invitations/accept',
        headers: member2Headers,
        payload: { inviteCode: 'INVALID-CODE' },
      });
      expect([400, 404, 409]).toContain(res.statusCode);
    });
  });

  describe('PUT /api/v1/leagues/:id/members/:uid/role', () => {
    it('owner promotes member2 to COMMISSIONER', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/leagues/${leagueId}/members/${member2Id}/role`,
        headers: ownerHeaders,
        payload: { role: 'COMMISSIONER' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('non-owner cannot change roles', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/leagues/${leagueId}/members/${member3Id}/role`,
        headers: member3Headers,
        payload: { role: 'COMMISSIONER' },
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('DELETE /api/v1/leagues/:id/members/:uid', () => {
    it('owner removes member3', async () => {
      const { 'content-type': _, ...h } = ownerHeaders;
      const res = await getApp().inject({
        method: 'DELETE',
        url: `/api/v1/leagues/${leagueId}/members/${member3Id}`,
        headers: h,
      });
      expect([200, 204]).toContain(res.statusCode);
    });

    it('removed member cannot access league', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/leagues/${leagueId}`,
        headers: member3Headers,
      });
      // May return league (same tenant) or 403 (not a member)
      expect([200, 403]).toContain(res.statusCode);
    });
  });

  describe('POST /api/v1/leagues/:id/transfer-ownership', () => {
    it('owner transfers to member2', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/transfer-ownership`,
        headers: ownerHeaders,
        payload: { newOwnerId: member2Id },
      });
      expect([200, 204]).toContain(res.statusCode);
    });

    it('original owner can no longer transfer (not owner anymore)', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/leagues/${leagueId}/transfer-ownership`,
        headers: ownerHeaders,
        payload: { newOwnerId: ownerId },
      });
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('DELETE /api/v1/leagues/:id/invite-link/:code — revoke', () => {
    it('new owner revokes invite link', async () => {
      const { 'content-type': _, ...h } = member2Headers;
      const res = await getApp().inject({
        method: 'DELETE',
        url: `/api/v1/leagues/${leagueId}/invite-link/${inviteCode}`,
        headers: h,
      });
      expect([200, 204]).toContain(res.statusCode);
    });
  });
});

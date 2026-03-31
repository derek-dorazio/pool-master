/**
 * Integration: League member management error paths and audit logs.
 *
 * Covers role-change errors, removal errors, ownership-transfer errors,
 * audit log retrieval, and dashboard access.
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

describe('League Member Errors & Audit Logs', () => {
  let ownerHeaders: Record<string, string>;
  let ownerId: string;
  let member2Headers: Record<string, string>;
  let member2Id: string;
  let member3Headers: Record<string, string>;
  let member3Id: string;
  let leagueId: string;

  beforeAll(async () => {
    // Create owner + 2 members
    const owner = await createTestUser({ displayName: 'ErrOwner' });
    ownerHeaders = owner.headers;
    ownerId = owner.user.id;

    const m2 = await createTestUser({ displayName: 'ErrMember2' });
    member2Headers = m2.headers;
    member2Id = m2.user.id;

    const m3 = await createTestUser({ displayName: 'ErrMember3' });
    member3Headers = m3.headers;
    member3Id = m3.user.id;

    // Owner creates league
    const createRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Error Paths League', visibility: 'PRIVATE', maxMembers: 10 },
    });
    leagueId = createRes.json().league.id;

    // Generate invite link
    const ilRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invite-link`,
      headers: ownerHeaders,
      payload: { expiresInDays: 7, maxUses: 10 },
    });
    const ilBody = ilRes.json();
    const inviteCode = ilBody.invitation?.inviteCode ?? ilBody.inviteCode ?? ilBody.code;

    // member2 joins via invite code
    const joinRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      headers: member2Headers,
      payload: { inviteCode },
    });
    expect([200, 201]).toContain(joinRes.statusCode);

    // member3 stays outside the league (not joined)
  });

  // -----------------------------------------------------------------------
  // 1. Change role of non-existent user
  // -----------------------------------------------------------------------
  it('PUT /leagues/:id/members/:uid/role — non-existent user returns 404', async () => {
    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    const res = await getApp().inject({
      method: 'PUT',
      url: `/api/v1/leagues/${leagueId}/members/${fakeUserId}/role`,
      headers: ownerHeaders,
      payload: { role: 'COMMISSIONER' },
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  // -----------------------------------------------------------------------
  // 2. Non-owner tries to change roles
  // -----------------------------------------------------------------------
  it('PUT /leagues/:id/members/:uid/role — non-owner gets 403', async () => {
    const res = await getApp().inject({
      method: 'PUT',
      url: `/api/v1/leagues/${leagueId}/members/${member2Id}/role`,
      headers: member2Headers,
      payload: { role: 'MANAGER' },
    });
    expect(res.statusCode).toBe(403);
  });

  // -----------------------------------------------------------------------
  // 3. Try to remove the owner
  // -----------------------------------------------------------------------
  it('DELETE /leagues/:id/members/:uid — removing owner returns 400', async () => {
    const { 'content-type': _, ...h } = ownerHeaders;
    const res = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${leagueId}/members/${ownerId}`,
      headers: h,
    });
    expect(res.statusCode).toBe(400);
  });

  // -----------------------------------------------------------------------
  // 4. Non-owner tries to remove a member
  // -----------------------------------------------------------------------
  it('DELETE /leagues/:id/members/:uid — non-owner gets 403', async () => {
    const { 'content-type': _, ...h } = member2Headers;
    const res = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${leagueId}/members/${ownerId}`,
      headers: h,
    });
    expect(res.statusCode).toBe(403);
  });

  // -----------------------------------------------------------------------
  // 5. Transfer ownership to non-member
  // -----------------------------------------------------------------------
  it('POST /leagues/:id/transfer-ownership — non-member target returns 404', async () => {
    const res = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/transfer-ownership`,
      headers: ownerHeaders,
      payload: { newOwnerId: member3Id },
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  // -----------------------------------------------------------------------
  // 6. Non-owner tries to transfer ownership
  // -----------------------------------------------------------------------
  it('POST /leagues/:id/transfer-ownership — non-owner gets 403', async () => {
    const res = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/transfer-ownership`,
      headers: member2Headers,
      payload: { newOwnerId: member2Id },
    });
    expect(res.statusCode).toBe(403);
  });

  // -----------------------------------------------------------------------
  // 7. Remove member that is already removed / doesn't exist
  // -----------------------------------------------------------------------
  it('DELETE /leagues/:id/members/:uid — non-existent member returns 404', async () => {
    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    const { 'content-type': _, ...h } = ownerHeaders;
    const res = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${leagueId}/members/${fakeUserId}`,
      headers: h,
    });
    expect(res.statusCode).toBe(404);
  });

  // -----------------------------------------------------------------------
  // 8. Audit log — returns entries (at least league create)
  // -----------------------------------------------------------------------
  it('GET /leagues/:id/audit-log — returns audit entries array', async () => {
    const res = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/audit-log`,
      headers: ownerHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 9. Member audit log
  // -----------------------------------------------------------------------
  it('GET /leagues/:id/audit-log/member — returns member audit entries', async () => {
    const res = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/audit-log/member`,
      headers: ownerHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 10. Dashboard — returns dashboard data
  // -----------------------------------------------------------------------
  it('GET /leagues/:id/dashboard — returns dashboard data', async () => {
    const res = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/dashboard`,
      headers: ownerHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Dashboard should contain league info, member count, and contests
    expect(body).toHaveProperty('league');
    expect(body).toHaveProperty('memberCount');
    expect(body).toHaveProperty('contests');
  });
});

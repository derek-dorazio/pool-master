import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  InvitationStatus,
  LeagueMembershipStatus,
  LeagueRole,
  LeagueVisibility,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('League membership CRUD integration', () => {
  it('activates, role-updates, inactivates, and reactivates a membership through real routes', async () => {
    const owner = await createTestUser({ displayName: 'Membership Lifecycle Owner' });
    const member = await createTestUser({ displayName: 'Membership Lifecycle Member' });

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: owner.headers,
      payload: {
        name: 'Membership Lifecycle League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });
    expect(leagueRes.statusCode).toBe(201);
    const leagueId = leagueRes.json().league.id as string;

    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: owner.headers,
      payload: {
        emails: [member.user.email],
      },
    });
    expect(inviteRes.statusCode).toBe(201);
    expect(inviteRes.json().sent[0].status).toBe(InvitationStatus.PENDING);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: member.headers,
      payload: {
        inviteCode: inviteRes.json().sent[0].inviteCode,
      },
    });
    expect(acceptRes.statusCode).toBe(201);

    const prisma = getPrisma();
    const createdMembership = await prisma.leagueMembership.findFirstOrThrow({
      where: {
        leagueId,
        userId: member.user.id,
      },
    });
    expect(createdMembership.role).toBe(LeagueRole.MEMBER);
    expect(createdMembership.status).toBe(LeagueMembershipStatus.ACTIVE);

    const promoteRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.memberRole(leagueId, member.user.id),
      headers: owner.headers,
      payload: {
        role: LeagueRole.COMMISSIONER,
        permissions: [],
      },
    });
    expect(promoteRes.statusCode).toBe(200);
    expect(promoteRes.json().membership.role).toBe(LeagueRole.COMMISSIONER);

    const removeRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.removeMember(leagueId, member.user.id),
      headers: withoutJsonBodyHeaders(owner.headers),
    });
    expect(removeRes.statusCode).toBe(200);

    const inactiveMembership = await prisma.leagueMembership.findUniqueOrThrow({
      where: { id: createdMembership.id },
    });
    expect(inactiveMembership.status).toBe(LeagueMembershipStatus.INACTIVE);

    const reinviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invite-link`,
      headers: owner.headers,
      payload: {
        maxUses: 1,
      },
    });
    expect(reinviteRes.statusCode).toBe(201);

    const reactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: member.headers,
      payload: {
        inviteCode: reinviteRes.json().invitation.inviteCode,
      },
    });
    expect(reactivateRes.statusCode).toBe(201);
    expect(reactivateRes.json().membership.id).toBe(createdMembership.id);
    expect(reactivateRes.json().membership.status).toBe(LeagueMembershipStatus.ACTIVE);

    const leaveRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.leave(leagueId),
      headers: withoutJsonBodyHeaders(member.headers),
    });
    expect(leaveRes.statusCode).toBe(200);

    const afterLeaveMembership = await prisma.leagueMembership.findUniqueOrThrow({
      where: { id: createdMembership.id },
    });
    expect(afterLeaveMembership.status).toBe(LeagueMembershipStatus.INACTIVE);
  });
});

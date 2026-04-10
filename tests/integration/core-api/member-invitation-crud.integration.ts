/**
 * CRUD-style integration coverage for invitations and league membership.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner and invitee users
 * - creates its own league
 * - sends an email invite
 * - generates an invite link
 * - accepts both invites through the real acceptance route
 * - lists league members
 * - removes one member and verifies the other can leave
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
import { InviteType, InvitationStatus, LeagueRole, LeagueVisibility } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Member and Invitation CRUD Integration', () => {
  let ownerHeaders: Record<string, string>;
  let ownerUserId: string;
  let leagueId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Membership CRUD Owner' });
    ownerHeaders = owner.headers;
    ownerUserId = owner.user.id;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Membership CRUD League',
        visibility: LeagueVisibility.PRIVATE,
        maxMembers: 12,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;
  });

  it('invites members, accepts invitations, lists members, removes a member, and supports self-leave', async () => {
    const emailInvitee = await createTestUser({ displayName: 'Membership CRUD Email Invitee' });
    const linkInvitee = await createTestUser({ displayName: 'Membership CRUD Link Invitee' });

    const emailInviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: ownerHeaders,
      payload: {
        emails: [emailInvitee.user.email],
        message: 'Join the league',
      },
    });

    expect(emailInviteRes.statusCode).toBe(201);
    const emailInvitePayload = emailInviteRes.json();
    expect(emailInvitePayload.sent).toHaveLength(1);
    expect(emailInvitePayload.skippedMembers).toEqual([]);
    expect(emailInvitePayload.skippedDuplicates).toEqual([]);
    expect(emailInvitePayload.sent[0].email).toBe(emailInvitee.user.email.toLowerCase());
    expect(emailInvitePayload.sent[0].inviteType).toBe(InviteType.EMAIL);
    expect(emailInvitePayload.sent[0].status).toBe(InvitationStatus.PENDING);

    const acceptEmailInviteRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: emailInvitee.headers,
      payload: {
        inviteCode: emailInvitePayload.sent[0].inviteCode,
      },
    });

    expect(acceptEmailInviteRes.statusCode).toBe(201);
    const emailMembership = acceptEmailInviteRes.json().membership;
    expect(emailMembership.leagueId).toBe(leagueId);
    expect(emailMembership.userId).toBe(emailInvitee.user.id);
    expect(emailMembership.role).toBe(LeagueRole.MEMBER);

    const inviteLinkRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.inviteLink(leagueId),
      headers: ownerHeaders,
      payload: {
        expiresInDays: 7,
        maxUses: 1,
      },
    });

    expect(inviteLinkRes.statusCode).toBe(201);
    const inviteLink = inviteLinkRes.json().invitation;
    expect(inviteLink.inviteType).toBe(InviteType.LINK);
    expect(inviteLink.status).toBe(InvitationStatus.PENDING);

    const acceptLinkInviteRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: linkInvitee.headers,
      payload: {
        inviteCode: inviteLink.inviteCode,
      },
    });

    expect(acceptLinkInviteRes.statusCode).toBe(201);
    const linkMembership = acceptLinkInviteRes.json().membership;
    expect(linkMembership.leagueId).toBe(leagueId);
    expect(linkMembership.userId).toBe(linkInvitee.user.id);
    expect(linkMembership.role).toBe(LeagueRole.MEMBER);

    const membersRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.members(leagueId),
      headers: ownerHeaders,
    });

    expect(membersRes.statusCode).toBe(200);
    const members = membersRes.json().members as Array<{ userId: string; role: string }>;
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: ownerUserId, role: LeagueRole.COMMISSIONER }),
        expect.objectContaining({ userId: emailInvitee.user.id, role: LeagueRole.MEMBER }),
        expect.objectContaining({ userId: linkInvitee.user.id, role: LeagueRole.MEMBER }),
      ]),
    );

    const removeRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.removeMember(leagueId, emailInvitee.user.id),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });

    expect(removeRes.statusCode).toBe(200);
    expect(removeRes.json()).toEqual({ success: true });

    const leaveRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.leave(leagueId),
      headers: withoutJsonBodyHeaders(linkInvitee.headers),
    });

    expect(leaveRes.statusCode).toBe(200);
    expect(leaveRes.json()).toEqual({ success: true });

    const finalMembersRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.members(leagueId),
      headers: ownerHeaders,
    });

    expect(finalMembersRes.statusCode).toBe(200);
    const finalMembers = finalMembersRes.json().members as Array<{ userId: string }>;
    expect(finalMembers).toHaveLength(1);
    expect(finalMembers[0].userId).toBe(ownerUserId);
  });
});

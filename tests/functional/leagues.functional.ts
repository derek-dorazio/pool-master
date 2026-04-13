import {
  acceptInvitation,
  changeMemberRole,
  createLeague,
  deleteLeague,
  generateInviteLink,
  getInvitationPreview,
  getLeagueDashboard,
  getLeague,
  inactivateLeague,
  leaveLeague,
  listLeagueMembers,
  listLeagues,
  removeMember,
  resolveActionItem,
  updateLeagueSettings,
} from '@poolmaster/shared/generated/hey-api';
import { randomUUID } from 'node:crypto';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
  getSdkClient,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

function buildCreateLeagueBody(name: string, description?: string) {
  return {
    name,
    leagueCode: `FUNC${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    ...(description ? { description } : {}),
  };
}

describe('SDK Functional: Leagues', () => {
  it('creates, lists, and reads a league through the generated SDK', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'League Commissioner',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('Functional League'),
    });

    expect(createResponse.data).toBeDefined();
    expect(createResponse.data?.league.id).toBeTruthy();
    expect(createResponse.data?.league.name).toBe('Functional League');
    expect(createResponse.data?.league.visibility).toBe('PRIVATE');
    expect(createResponse.data?.league.role).toBe('COMMISSIONER');
    expect(createResponse.data?.league.memberCount).toBe(1);

    const leagueId = createResponse.data?.league.id;
    expect(leagueId).toBeTruthy();

    const listResponse = await listLeagues({
      client: commissioner.client,
    });

    expect(listResponse.data).toBeDefined();
    const listedLeague = listResponse.data?.leagues.find((league) => league.id === leagueId);
    expect(listedLeague).toBeDefined();
    expect(listedLeague?.name).toBe('Functional League');
    expect(listedLeague?.role).toBe('COMMISSIONER');

    const detailResponse = await getLeague({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
    });

    expect(detailResponse.data).toBeDefined();
    expect(detailResponse.data?.league.id).toBe(leagueId);
    expect(detailResponse.data?.league.name).toBe('Functional League');
    expect(detailResponse.data?.league.role).toBe('COMMISSIONER');
    expect(detailResponse.data?.league.memberCount).toBe(1);
  });

  it('generates a commissioner invite link and accepts it for another authenticated user', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'League Commissioner',
    });
    const invitee = await buildRegisteredUser({
      displayName: 'League Invitee',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('Invite Flow League'),
    });

    const leagueId = createResponse.data?.league.id;
    expect(leagueId).toBeTruthy();

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
        expiresInDays: 7,
      },
    });

    expect(invitationResponse.data).toBeDefined();
    expect(invitationResponse.data?.invitation.leagueId).toBe(leagueId);
    expect(invitationResponse.data?.invitation.inviteCode).toBeTruthy();
    expect(invitationResponse.data?.invitation.status).toBe('PENDING');
    expect(invitationResponse.data?.invitation.currentUses).toBe(0);
    expect(invitationResponse.data?.invitation.maxUses).toBe(1);
    expect(invitationResponse.data?.invitation.invitedBy).toBe(commissioner.userId);

    const acceptResponse = await acceptInvitation({
      client: invitee.client,
      body: {
        inviteCode: invitationResponse.data?.invitation.inviteCode as string,
      },
    });

    expect(acceptResponse.data).toBeDefined();
    expect(acceptResponse.data?.membership.leagueId).toBe(leagueId);
    expect(acceptResponse.data?.membership.userId).toBe(invitee.userId);
    expect(acceptResponse.data?.membership.role).toBe('MEMBER');
    expect(acceptResponse.data?.membership.status).toBe('ACTIVE');

    const inviteeLeagues = await listLeagues({
      client: invitee.client,
    });

    expect(inviteeLeagues.data).toBeDefined();
    const joinedLeague = inviteeLeagues.data?.leagues.find((league) => league.id === leagueId);
    expect(joinedLeague).toBeDefined();
    expect(joinedLeague?.role).toBe('MEMBER');

    const inviteeDetail = await getLeague({
      client: invitee.client,
      path: {
        id: leagueId as string,
      },
    });

    expect(inviteeDetail.data).toBeDefined();
    expect(inviteeDetail.data?.league.id).toBe(leagueId);
    expect(inviteeDetail.data?.league.role).toBe('MEMBER');
  });

  it('allows an unauthenticated user to preview a league invitation by invite code', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'League Commissioner',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('Public Invite Preview League'),
    });

    const leagueId = createResponse.data?.league.id;
    const leagueCode = createResponse.data?.league.leagueCode;
    expect(leagueId).toBeTruthy();
    expect(leagueCode).toBeTruthy();

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
        expiresInDays: 7,
      },
    });

    const inviteCode = invitationResponse.data?.invitation.inviteCode;
    expect(inviteCode).toBeTruthy();

    const previewResponse = await getInvitationPreview({
      client: getSdkClient(),
      path: {
        inviteCode: inviteCode as string,
      },
    });

    expect(previewResponse.data?.invitation.inviteCode).toBe(inviteCode);
    expect(previewResponse.data?.invitation.status).toBe('PENDING');
    expect(previewResponse.data?.invitation.league.id).toBe(leagueId);
    expect(previewResponse.data?.invitation.league.leagueCode).toBe(leagueCode);
    expect(previewResponse.data?.invitation.league.name).toBe('Public Invite Preview League');
  });

  it('rejects a non-commissioner from generating invite links', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'League Commissioner',
    });
    const member = await buildRegisteredUser({
      displayName: 'League Member',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('Negative Invite League'),
    });

    const leagueId = createResponse.data?.league.id;
    expect(leagueId).toBeTruthy();

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
      },
    });

    expect(invitationResponse.data?.invitation.inviteCode).toBeTruthy();

    const acceptResponse = await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: invitationResponse.data?.invitation.inviteCode as string,
      },
    });

    expect(acceptResponse.data).toBeDefined();

    const forbiddenResponse = await generateInviteLink({
      client: member.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
      },
    });

    expectFunctionalError(forbiddenResponse, {
      status: 403,
      code: 'LEAGUE_PERMISSION_DENIED',
    });
  });

  it('rejects reusing an already accepted invite link with a stable invitation error code', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'League Commissioner',
    });
    const firstInvitee = await buildRegisteredUser({
      displayName: 'First Invitee',
    });
    const secondInvitee = await buildRegisteredUser({
      displayName: 'Second Invitee',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('Exhausted Invite League'),
    });

    const leagueId = createResponse.data?.league.id;
    expect(leagueId).toBeTruthy();

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
      },
    });

    const inviteCode = invitationResponse.data?.invitation.inviteCode;
    expect(inviteCode).toBeTruthy();

    const firstAcceptResponse = await acceptInvitation({
      client: firstInvitee.client,
      body: {
        inviteCode: inviteCode as string,
      },
    });

    expect(firstAcceptResponse.data?.membership.leagueId).toBe(leagueId);

    const secondAcceptResponse = await acceptInvitation({
      client: secondInvitee.client,
      body: {
        inviteCode: inviteCode as string,
      },
    });

    expectFunctionalError(secondAcceptResponse, {
      status: 400,
      code: 'LEAGUE_INVITATION_ALREADY_ACCEPTED',
    });
  });

  it('updates league settings and manages the member lifecycle through the generated SDK', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'Settings Commissioner',
    });
    const member = await buildRegisteredUser({
      displayName: 'Settings Member',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('League Settings Flow'),
    });

    const leagueId = createResponse.data?.league.id;
    expect(leagueId).toBeTruthy();

    const updateResponse = await updateLeagueSettings({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        invitePolicy: 'OPEN',
        allowMidSeasonJoin: true,
        requireApproval: false,
        weeklyRecapEnabled: true,
        weeklyRecapDay: 'MONDAY',
        timezone: 'America/New_York',
        currency: 'USD',
      },
    });

    expect(updateResponse.data).toBeDefined();
    expect(updateResponse.data?.league.invitePolicy).toBe('OPEN');
    expect(updateResponse.data?.league.settings).toEqual(
      expect.objectContaining({
        invitePolicy: 'OPEN',
        allowMidSeasonJoin: true,
        requireApproval: false,
        weeklyRecapEnabled: true,
        weeklyRecapDay: 'MONDAY',
        timezone: 'America/New_York',
        currency: 'USD',
      }),
    );

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
      },
    });

    const inviteCode = invitationResponse.data?.invitation.inviteCode;
    expect(inviteCode).toBeTruthy();

    const firstAcceptResponse = await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: inviteCode as string,
      },
    });

    expect(firstAcceptResponse.data?.membership.role).toBe('MEMBER');
    expect(firstAcceptResponse.data?.membership.status).toBe('ACTIVE');

    const membersResponse = await listLeagueMembers({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
    });

    expect(membersResponse.data).toBeDefined();
    expect(membersResponse.data?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: commissioner.userId,
          role: 'COMMISSIONER',
        }),
        expect.objectContaining({
          userId: member.userId,
          role: 'MEMBER',
        }),
      ]),
    );

    const promoteResponse = await changeMemberRole({
      client: commissioner.client,
      path: {
        id: leagueId as string,
        uid: member.userId,
      },
      body: {
        role: 'COMMISSIONER',
      },
    });

    expect(promoteResponse.data).toBeDefined();
    expect(promoteResponse.data?.membership.role).toBe('COMMISSIONER');
    expect(promoteResponse.data?.membership.status).toBe('ACTIVE');

    const removeResponse = await removeMember({
      client: commissioner.client,
      path: {
        id: leagueId as string,
        uid: member.userId,
      },
    });

    expect(removeResponse.data).toEqual({ success: true });

    const secondInviteResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
      },
    });

    const reactivatedMembership = await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: secondInviteResponse.data?.invitation.inviteCode as string,
      },
    });

    expect(reactivatedMembership.data).toBeDefined();
    expect(reactivatedMembership.data?.membership.userId).toBe(member.userId);
    expect(reactivatedMembership.data?.membership.status).toBe('ACTIVE');

    const leaveResponse = await leaveLeague({
      client: member.client,
      path: {
        id: leagueId as string,
      },
    });

    expect(leaveResponse.data).toEqual({ success: true });

    const secondLeaveResponse = await leaveLeague({
      client: member.client,
      path: {
        id: leagueId as string,
      },
    });

    expectFunctionalError(secondLeaveResponse, {
      status: 400,
      code: 'LEAGUE_MEMBER_ALREADY_INACTIVE',
    });
  });

  it('rejects non-commissioners from member management routes with stable league permission codes', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'Management Commissioner',
    });
    const member = await buildRegisteredUser({
      displayName: 'Managed Member',
    });
    const outsider = await buildRegisteredUser({
      displayName: 'Management Outsider',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('League Management Negative Flow'),
    });

    const leagueId = createResponse.data?.league.id;
    expect(leagueId).toBeTruthy();

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
      },
    });

    const inviteCode = invitationResponse.data?.invitation.inviteCode;
    expect(inviteCode).toBeTruthy();

    const acceptResponse = await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: inviteCode as string,
      },
    });

    expect(acceptResponse.data?.membership.userId).toBe(member.userId);

    const outsiderMembersResponse = await listLeagueMembers({
      client: outsider.client,
      path: {
        id: leagueId as string,
      },
    });

    expectFunctionalError(outsiderMembersResponse, {
      status: 403,
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });

    const memberRoleResponse = await changeMemberRole({
      client: member.client,
      path: {
        id: leagueId as string,
        uid: member.userId,
      },
      body: {
        role: 'COMMISSIONER',
      },
    });

    expectFunctionalError(memberRoleResponse, {
      status: 403,
      code: 'LEAGUE_PERMISSION_DENIED',
    });

    const outsiderRemoveResponse = await removeMember({
      client: outsider.client,
      path: {
        id: leagueId as string,
        uid: member.userId,
      },
    });

    expectFunctionalError(outsiderRemoveResponse, {
      status: 403,
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });
  });

  it('rejects non-commissioners from commissioner dashboard and action-item flows', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'Dashboard Commissioner',
    });
    const member = await buildRegisteredUser({
      displayName: 'Dashboard Member',
    });
    const outsider = await buildRegisteredUser({
      displayName: 'Dashboard Outsider',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('League Dashboard Negative Flow'),
    });

    const leagueId = createResponse.data?.league.id;
    expect(leagueId).toBeTruthy();

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: leagueId as string,
      },
      body: {
        maxUses: 1,
      },
    });

    const acceptResponse = await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: invitationResponse.data?.invitation.inviteCode as string,
      },
    });

    expect(acceptResponse.data?.membership.userId).toBe(member.userId);

    const actionItem = await getFunctionalPrisma().commissionerActionItem.create({
      data: {
        leagueId: leagueId as string,
        type: 'JOIN_REQUEST',
        priority: 'MEDIUM',
        title: 'Review pending request',
        description: 'A member action requires commissioner review.',
        actionUrl: `/leagues/${leagueId}`,
      },
    });

    const memberDashboardResponse = await getLeagueDashboard({
      client: member.client,
      path: {
        id: leagueId as string,
      },
    });

    expectFunctionalError(memberDashboardResponse, {
      status: 403,
      code: 'LEAGUE_PERMISSION_DENIED',
    });

    const outsiderDashboardResponse = await getLeagueDashboard({
      client: outsider.client,
      path: {
        id: leagueId as string,
      },
    });

    expectFunctionalError(outsiderDashboardResponse, {
      status: 403,
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });

    const memberResolveResponse = await resolveActionItem({
      client: member.client,
      path: {
        id: leagueId as string,
        itemId: actionItem.id,
      },
    });

    expectFunctionalError(memberResolveResponse, {
      status: 403,
      code: 'LEAGUE_PERMISSION_DENIED',
    });
  });

  it('requires inactive-first league delete with exact leagueCode confirmation and preserves user accounts', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'Lifecycle Commissioner',
    });
    const member = await buildRegisteredUser({
      displayName: 'Lifecycle Member',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: buildCreateLeagueBody('Lifecycle League'),
    });

    const leagueId = createResponse.data?.league.id as string;
    const leagueCode = createResponse.data?.league.leagueCode as string;

    const invitationResponse = await generateInviteLink({
      client: commissioner.client,
      path: { id: leagueId },
      body: { maxUses: 1 },
    });

    await acceptInvitation({
      client: member.client,
      body: {
        inviteCode: invitationResponse.data?.invitation.inviteCode as string,
      },
    });

    const activeDeleteResponse = await deleteLeague({
      client: commissioner.client,
      path: { id: leagueId },
      body: { leagueCode },
    });

    expectFunctionalError(activeDeleteResponse, {
      status: 400,
      code: 'LEAGUE_DELETE_REQUIRES_INACTIVE',
    });

    const inactivateResponse = await inactivateLeague({
      client: commissioner.client,
      path: { id: leagueId },
    });

    expect(inactivateResponse.data?.league.isActive).toBe(false);

    const wrongCodeDeleteResponse = await deleteLeague({
      client: commissioner.client,
      path: { id: leagueId },
      body: { leagueCode: `${leagueCode}X` },
    });

    expectFunctionalError(wrongCodeDeleteResponse, {
      status: 400,
      code: 'LEAGUE_DELETE_CONFIRMATION_MISMATCH',
    });

    const deleteResponse = await deleteLeague({
      client: commissioner.client,
      path: { id: leagueId },
      body: { leagueCode },
    });

    expect(deleteResponse.data).toEqual({ success: true });

    const commissionerLeagues = await listLeagues({
      client: commissioner.client,
    });
    expect(commissionerLeagues.data?.leagues).toEqual([]);

    const memberLeagues = await listLeagues({
      client: member.client,
    });
    expect(memberLeagues.data?.leagues).toEqual([]);

    const deletedLeagueResponse = await getLeague({
      client: commissioner.client,
      path: { id: leagueId },
    });

    expectFunctionalError(deletedLeagueResponse, {
      status: 404,
      code: 'LEAGUE_NOT_FOUND',
    });
  });
});

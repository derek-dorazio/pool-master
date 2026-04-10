import {
  acceptInvitation,
  createLeague,
  generateInviteLink,
  getLeague,
  listLeagues,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Leagues', () => {
  it('creates, lists, and reads a league through the generated SDK', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'League Commissioner',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: {
        name: 'Functional League',
        visibility: 'PRIVATE',
        settings: {
          invitePolicy: 'COMMISSIONER_ONLY',
        },
      },
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
      body: {
        name: 'Invite Flow League',
        visibility: 'PRIVATE',
        settings: {
          invitePolicy: 'COMMISSIONER_ONLY',
        },
      },
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

  it('rejects a non-commissioner from generating invite links', async () => {
    const commissioner = await buildRegisteredUser({
      displayName: 'League Commissioner',
    });
    const member = await buildRegisteredUser({
      displayName: 'League Member',
    });

    const createResponse = await createLeague({
      client: commissioner.client,
      body: {
        name: 'Negative Invite League',
        visibility: 'PRIVATE',
        settings: {
          invitePolicy: 'COMMISSIONER_ONLY',
        },
      },
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
});

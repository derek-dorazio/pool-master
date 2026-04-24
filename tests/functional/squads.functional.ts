import {
  acceptInvitation,
  createLeagueSquad,
  generateInviteLink,
  loginUser,
  listLeagueSquads,
} from '@poolmaster/shared/generated/hey-api';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  createAuthenticatedClient,
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

describe('SDK Functional: Squads', () => {
  it('provisions default teams during league creation and invitation acceptance', async () => {
    const { league, commissioner } = await buildLeagueWithCommissioner({
      displayName: 'Squad Commissioner',
      leagueName: 'Functional Squad League',
    });
    const invitee = await buildRegisteredUser({
      displayName: 'Squad Invitee',
    });

    const inviteResponse = await generateInviteLink({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        maxUses: 1,
      },
    });

    expect(inviteResponse.data).toBeDefined();

    const acceptResponse = await acceptInvitation({
      client: invitee.client,
      body: {
        inviteCode: inviteResponse.data?.invitation.inviteCode as string,
      },
    });

    expect(acceptResponse.data).toBeDefined();
    expect(acceptResponse.data?.membership.leagueId).toBe(league.id);
    expect(acceptResponse.data?.membership.userId).toBe(invitee.userId);

    const commissionerSquads = await listLeagueSquads({
      client: commissioner.client,
      path: {
        id: league.id,
      },
    });

    const commissionerTeam = commissionerSquads.data?.squads.find(
      (squad) => squad.createdBy === commissioner.userId,
    );

    expect(commissionerTeam).toBeDefined();
    expect(commissionerTeam?.leagueId).toBe(league.id);
    expect(commissionerTeam?.isActive).toBe(true);
    expect(commissionerTeam?.memberCount).toBe(1);
    expect(commissionerTeam?.teamRelationship).toEqual({
      leagueMember: true,
      owner: true,
      commissioner: true,
    });
    expect(commissionerTeam?.isRootAdmin).toBe(false);

    const inviteeTeam = await getFunctionalPrisma().squad.findFirst({
      where: {
        leagueId: league.id,
        createdBy: invitee.userId,
        isActive: true,
      },
      include: {
        memberships: {
          where: {
            status: 'ACTIVE',
          },
        },
      },
    });

    expect(inviteeTeam).toBeDefined();
    expect(inviteeTeam?.leagueId).toBe(league.id);
    expect(inviteeTeam?.isActive).toBe(true);
    expect(inviteeTeam?.memberships).toHaveLength(1);

    const duplicateCreateResponse = await createLeagueSquad({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Second Commissioner Team',
      },
    });

    expectFunctionalError(duplicateCreateResponse, {
      status: 400,
      code: 'SQUAD_MEMBERSHIP_CONFLICT',
    });
  });

  it('rejects a non-league member from creating a squad', async () => {
    const { league, commissioner } = await buildLeagueWithCommissioner({
      displayName: 'Squad Commissioner',
      leagueName: 'Negative Squad League',
    });
    const outsider = await buildRegisteredUser({
      displayName: 'Squad Outsider',
    });

    const listResponse = await listLeagueSquads({
      client: commissioner.client,
      path: {
        id: league.id,
      },
    });

    expect(listResponse.data?.squads).toHaveLength(1);

    const outsiderResponse = await createLeagueSquad({
      client: outsider.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Outsider Squad',
      },
    });

    expectFunctionalError(outsiderResponse, {
      status: 400,
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });
  });

  it('allows a root admin to list league teams without league membership and emits relationship truth', async () => {
    const { league } = await buildLeagueWithCommissioner({
      displayName: 'Root Team Commissioner',
      leagueName: 'Root Team League',
    });
    const rootAdmin = await buildRegisteredUser({
      displayName: 'Root Team Admin',
    });

    await getFunctionalPrisma().user.update({
      where: { id: rootAdmin.userId },
      data: { isRootAdmin: true },
    });

    const relogin = await loginUser({
      client: getSdkClient(),
      body: {
        identifier: rootAdmin.username,
        password: rootAdmin.password,
      },
    });

    if (!relogin.data) {
      throw new Error('Expected relogin after root-admin promotion to succeed.');
    }

    const rootClient = createAuthenticatedClient(relogin.data.tokens.accessToken);
    const response = await listLeagueSquads({
      client: rootClient,
      path: {
        id: league.id,
      },
    });

    expect(response.data?.squads).toHaveLength(1);
    expect(response.data?.squads[0]?.teamRelationship).toEqual({
      leagueMember: false,
      owner: false,
      commissioner: false,
    });
    expect(response.data?.squads[0]?.isRootAdmin).toBe(true);
  });
});

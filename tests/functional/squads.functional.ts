import {
  acceptInvitation,
  createLeagueSquad,
  generateInviteLink,
  listLeagueSquads,
} from '@poolmaster/shared/generated/hey-api';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
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
    expect(commissionerTeam?.status).toBe('ACTIVE');
    expect(commissionerTeam?.memberCount).toBe(1);

    const inviteeTeam = await getFunctionalPrisma().squad.findFirst({
      where: {
        leagueId: league.id,
        createdBy: invitee.userId,
        status: 'ACTIVE',
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
    expect(inviteeTeam?.status).toBe('ACTIVE');
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
});

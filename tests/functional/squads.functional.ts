import {
  acceptInvitation,
  createLeagueSquad,
  createSquadOwnerInvitation,
  generateInviteLink,
  loginUser,
  listLeagueSquads,
  registerWithTeamOwnerInvitation,
} from '@poolmaster/shared/generated/hey-api';
import { randomUUID } from 'node:crypto';
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
  /**
   * #217 — register against a squad-owner invitation and accept it, in one request.
   *
   * The flow for an invited email with no PoolMaster account, which `acceptTeamOwnerInvitation`
   * cannot serve because it requires an authenticated caller. Exercised here rather than only in
   * unit tests because the point is the end-to-end result: the stranger ends up signed in, in the
   * league, and on the squad they were invited to.
   */
  describe('register with a team-owner invitation (#217)', () => {
    it('registers a stranger, joins them to the league and squad, and signs them in', async () => {
      const { league, commissioner, commissionerClient } = await buildLeagueWithCommissioner({
        displayName: 'Owner Invite Commissioner',
        leagueName: 'Owner Invite League',
      });

      const squadsResponse = await listLeagueSquads({
        client: commissionerClient,
        path: { id: league.id },
      });
      const commissionerSquadId = squadsResponse.data?.squads[0]?.id as string;
      expect(commissionerSquadId).toBeTruthy();

      const inviteEmail = `stranger-${randomUUID().slice(0, 8)}@functional.test`;
      const inviteResponse = await createSquadOwnerInvitation({
        client: commissionerClient,
        path: { id: league.id, squadId: commissionerSquadId },
        body: { email: inviteEmail },
      });

      // No account behind this address, so the invitation really is PENDING — unlike the
      // existing-user case, which `createSquadOwnerInvitation` accepts on the spot.
      expect(inviteResponse.data?.invitation.status).toBe('PENDING');
      const inviteCode = inviteResponse.data?.invitation.inviteCode as string;

      const password = 'Stranger-pass-1!';
      const registerResponse = await registerWithTeamOwnerInvitation({
        client: getSdkClient(),
        body: {
          inviteCode,
          username: `stranger-${randomUUID().slice(0, 8)}`,
          password,
          firstName: 'Sam',
          lastName: 'Stranger',
        },
      });

      expect(registerResponse.data?.user.email).toBe(inviteEmail);
      expect(registerResponse.data?.tokens.accessToken).toBeTruthy();
      const newUserId = registerResponse.data?.user.id as string;

      // In the league, on the invited squad, in one request.
      const membership = await getFunctionalPrisma().leagueMembership.findFirstOrThrow({
        where: { leagueId: league.id, userId: newUserId },
      });
      expect(membership.status).toBe('ACTIVE');
      expect(membership.role).toBe('MEMBER');

      const squadMembership = await getFunctionalPrisma().squadMembership.findFirstOrThrow({
        where: { leagueId: league.id, userId: newUserId },
      });
      expect(squadMembership.status).toBe('ACTIVE');
      // The invited squad — a co-owner, not a squad of their own. This is the only way two people
      // share one squad, because SquadMembership is unique on (leagueId, userId).
      expect(squadMembership.squadId).toBe(commissionerSquadId);

      // The returned session is usable, and the password they chose works for a real login.
      const loginResponse = await loginUser({
        client: getSdkClient(),
        body: { identifier: inviteEmail, password },
      });
      expect(loginResponse.data?.user.id).toBe(newUserId);

      expect(commissioner.userId).not.toBe(newUserId);
    });

    it('refuses to register when the invited email already has an account', async () => {
      const { league, commissionerClient } = await buildLeagueWithCommissioner({
        displayName: 'Existing User Commissioner',
        leagueName: 'Existing User League',
      });
      const existing = await buildRegisteredUser({ displayName: 'Already Registered' });

      const squadsResponse = await listLeagueSquads({
        client: commissionerClient,
        path: { id: league.id },
      });
      const commissionerSquadId = squadsResponse.data?.squads[0]?.id as string;

      const inviteResponse = await createSquadOwnerInvitation({
        client: commissionerClient,
        path: { id: league.id, squadId: commissionerSquadId },
        body: { email: existing.email },
      });

      // The existing-user path provisions immediately, so there is nothing left to register
      // against. Asserted because it is the branch that makes this whole route's scope narrow.
      expect(inviteResponse.data?.invitation.status).toBe('ACCEPTED');

      const registerResponse = await registerWithTeamOwnerInvitation({
        client: getSdkClient(),
        body: {
          inviteCode: inviteResponse.data?.invitation.inviteCode as string,
          username: `dupe-${randomUUID().slice(0, 8)}`,
          password: 'Dupe-pass-1!',
          firstName: 'Dupe',
          lastName: 'User',
        },
      });

      expectFunctionalError(registerResponse, {
        status: 400,
        code: 'SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED',
      });
    });
  });

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
  });
});

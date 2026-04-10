import {
  acceptInvitation,
  addSquadCoManager,
  createLeagueSquad,
  generateInviteLink,
  removeSquadCoManager,
} from '@poolmaster/shared/generated/hey-api';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
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

describe('SDK Functional: Squads', () => {
  it('creates a squad and manages co-manager membership through the generated SDK', async () => {
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

    const createResponse = await createLeagueSquad({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Functional Squad',
      },
    });

    expect(createResponse.data).toBeDefined();
    expect(createResponse.data?.squad.leagueId).toBe(league.id);
    expect(createResponse.data?.squad.createdBy).toBe(commissioner.userId);
    expect(createResponse.data?.squad.name).toBe('Functional Squad');
    expect(createResponse.data?.squad.status).toBe('ACTIVE');
    expect(createResponse.data?.squad.memberCount).toBe(1);

    const squadId = createResponse.data?.squad.id as string;

    const addResponse = await addSquadCoManager({
      client: commissioner.client,
      path: {
        id: league.id,
        squadId,
      },
      body: {
        userId: invitee.userId,
      },
    });

    expect(addResponse.data).toBeDefined();
    expect(addResponse.data?.membership.squadId).toBe(squadId);
    expect(addResponse.data?.membership.leagueId).toBe(league.id);
    expect(addResponse.data?.membership.userId).toBe(invitee.userId);
    expect(addResponse.data?.membership.status).toBe('ACTIVE');

    const removeResponse = await removeSquadCoManager({
      client: commissioner.client,
      path: {
        id: league.id,
        squadId,
        userId: invitee.userId,
      },
    });

    expect(removeResponse.data).toBeDefined();
    expect(removeResponse.data?.membership.userId).toBe(invitee.userId);
    expect(removeResponse.data?.membership.status).toBe('INACTIVE');
  });

  it('rejects a non-league member from creating a squad', async () => {
    const { league, commissioner } = await buildLeagueWithCommissioner({
      displayName: 'Squad Commissioner',
      leagueName: 'Negative Squad League',
    });
    const outsider = await buildRegisteredUser({
      displayName: 'Squad Outsider',
    });

    const createResponse = await createLeagueSquad({
      client: commissioner.client,
      path: {
        id: league.id,
      },
      body: {
        name: 'Commissioner Squad',
      },
    });

    expect(createResponse.data).toBeDefined();

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
      code: 'BAD_REQUEST',
    });
  });
});

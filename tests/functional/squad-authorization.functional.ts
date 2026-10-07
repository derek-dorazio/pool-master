/**
 * #292 — the squad routes under `/leagues/:id/squads` now declare their gates as route
 * `preHandler`s instead of leaving every check to `SquadService`: league membership to read,
 * ownership of the squad (or the league's commissionership, access rule A7) to act for it,
 * the commissioner gate to inactivate, and the root-admin guard to delete.
 *
 * Real HTTP through the generated SDK against a spawned server, because a route-level gate is only
 * observable there. Each refused write also re-reads the squad, so a 403 that still wrote fails:
 * a hook that sends its refusal without awaiting it lets Fastify run the handler anyway.
 */
import {
  acceptInvitation,
  createLeagueSquad,
  deleteLeagueSquad,
  generateInviteLink,
  getLeagueSquad,
  inactivateLeagueSquad,
  listLeagueSquads,
  updateLeagueSquad,
} from '@poolmaster/shared/generated/hey-api';
import { buildLeagueWithCommissioner, buildRegisteredUser } from './builders';
import type { RegisteredUserContext } from './builders';
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

async function joinLeague(commissioner: RegisteredUserContext, leagueId: string, user: RegisteredUserContext) {
  const inviteLink = await generateInviteLink({
    client: commissioner.client,
    path: { id: leagueId },
    body: { maxUses: 1 },
  });
  const accepted = await acceptInvitation({
    client: user.client,
    body: { inviteCode: inviteLink.data?.invitation.inviteCode as string },
  });
  expect(accepted.data?.membership.userId).toBe(user.userId);
}

async function squadOf(leagueId: string, userId: string) {
  const squad = await getFunctionalPrisma().squad.findFirst({
    where: { leagueId, createdBy: userId, isActive: true },
  });
  if (!squad) {
    throw new Error(`Expected ${userId} to own an active squad in ${leagueId}.`);
  }
  return squad;
}

/** A league with its commissioner, two members who each own their default squad, and an outsider. */
async function buildLeagueWithTwoOwners() {
  const { league, commissioner } = await buildLeagueWithCommissioner({
    displayName: 'Squad Authz Commissioner',
    leagueName: 'Squad Authorization League',
  });
  const owner = await buildRegisteredUser({ displayName: 'Squad Authz Owner' });
  const otherOwner = await buildRegisteredUser({ displayName: 'Squad Authz Other Owner' });
  const outsider = await buildRegisteredUser({ displayName: 'Squad Authz Outsider' });
  await joinLeague(commissioner, league.id, owner);
  await joinLeague(commissioner, league.id, otherOwner);
  const ownerSquad = await squadOf(league.id, owner.userId);
  return { league, commissioner, owner, otherOwner, outsider, ownerSquad };
}

async function expectSquadName(squadId: string, name: string) {
  const reread = await getFunctionalPrisma().squad.findUnique({ where: { id: squadId } });
  expect(reread?.name).toBe(name);
  expect(reread?.isActive).toBe(true);
}

describe('SDK Functional: squad route authorization (#292)', () => {
  it('lets the squad\'s owner rename it', async () => {
    const { league, owner, ownerSquad } = await buildLeagueWithTwoOwners();
    const response = await updateLeagueSquad({
      client: owner.client,
      path: { id: league.id, squadId: ownerSquad.id },
      body: { name: 'Renamed By Owner' },
    });
    expect(response.response.status).toBe(200);
    await expectSquadName(ownerSquad.id, 'Renamed By Owner');
  });

  it('lets the league commissioner rename a member\'s squad (access rule A7)', async () => {
    const { league, commissioner, ownerSquad } = await buildLeagueWithTwoOwners();
    const response = await updateLeagueSquad({
      client: commissioner.client,
      path: { id: league.id, squadId: ownerSquad.id },
      body: { name: 'Renamed By Commissioner' },
    });
    expect(response.response.status).toBe(200);
    await expectSquadName(ownerSquad.id, 'Renamed By Commissioner');
  });

  it('refuses a league member renaming another member\'s squad with 403, and the name does not change', async () => {
    const { league, otherOwner, ownerSquad } = await buildLeagueWithTwoOwners();
    const response = await updateLeagueSquad({
      client: otherOwner.client,
      path: { id: league.id, squadId: ownerSquad.id },
      body: { name: 'Hijacked' },
    });
    expectFunctionalError(response, { status: 403, code: 'SQUAD_OWNER_REQUIRED' });
    await expectSquadName(ownerSquad.id, ownerSquad.name);
  });

  it('refuses an outsider renaming a squad with 403, and the name does not change', async () => {
    const { league, outsider, ownerSquad } = await buildLeagueWithTwoOwners();
    const response = await updateLeagueSquad({
      client: outsider.client,
      path: { id: league.id, squadId: ownerSquad.id },
      body: { name: 'Hijacked' },
    });
    expectFunctionalError(response, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
    await expectSquadName(ownerSquad.id, ownerSquad.name);
  });

  it('answers 404 when the path pairs a league with a squad from another league', async () => {
    const { owner, ownerSquad } = await buildLeagueWithTwoOwners();
    const { league: otherLeague, commissioner: otherCommissioner } = await buildLeagueWithCommissioner({
      displayName: 'Other League Commissioner',
      leagueName: 'Other Squad League',
    });
    await joinLeague(otherCommissioner, otherLeague.id, owner);
    const response = await updateLeagueSquad({
      client: owner.client,
      path: { id: otherLeague.id, squadId: ownerSquad.id },
      body: { name: 'Cross League' },
    });
    expectFunctionalError(response, { status: 404, code: 'SQUAD_NOT_FOUND' });
    await expectSquadName(ownerSquad.id, ownerSquad.name);
  });

  it('refuses an outsider reading the league\'s squads, one or all, with 403', async () => {
    const { league, outsider, ownerSquad } = await buildLeagueWithTwoOwners();
    const list = await listLeagueSquads({ client: outsider.client, path: { id: league.id } });
    expectFunctionalError(list, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
    const one = await getLeagueSquad({ client: outsider.client, path: { id: league.id, squadId: ownerSquad.id } });
    expectFunctionalError(one, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
  });

  it('lets a member read another member\'s squad', async () => {
    const { league, otherOwner, ownerSquad } = await buildLeagueWithTwoOwners();
    const response = await getLeagueSquad({ client: otherOwner.client, path: { id: league.id, squadId: ownerSquad.id } });
    expect(response.response.status).toBe(200);
    expect(response.data?.squad.id).toBe(ownerSquad.id);
  });

  it('refuses an outsider creating a squad with 403 from the league gate', async () => {
    const { league, outsider } = await buildLeagueWithTwoOwners();
    const response = await createLeagueSquad({
      client: outsider.client,
      path: { id: league.id },
      body: { name: 'Outsider Squad' },
    });
    expectFunctionalError(response, { status: 403, code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
  });

  it('refuses a squad\'s own owner inactivating it with 403, and it stays active (commissioner only)', async () => {
    const { league, owner, ownerSquad } = await buildLeagueWithTwoOwners();
    const response = await inactivateLeagueSquad({
      client: owner.client,
      path: { id: league.id, squadId: ownerSquad.id },
    });
    expectFunctionalError(response, { status: 403, code: 'LEAGUE_PERMISSION_DENIED' });
    await expectSquadName(ownerSquad.id, ownerSquad.name);
  });

  it('refuses the commissioner deleting a squad with 403, and the squad survives (root admin only)', async () => {
    const { league, commissioner, ownerSquad } = await buildLeagueWithTwoOwners();
    const response = await deleteLeagueSquad({
      client: commissioner.client,
      path: { id: league.id, squadId: ownerSquad.id },
    });
    expectFunctionalError(response, { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' });
    await expectSquadName(ownerSquad.id, ownerSquad.name);
  });
});

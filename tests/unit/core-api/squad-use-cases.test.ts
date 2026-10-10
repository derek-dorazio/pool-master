import { expect } from '@jest/globals';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
  type League,
  type Squad,
  type User,
} from '@poolmaster/shared/domain';
import { SquadNotFoundError, SquadOperationError } from '../../../packages/core-api/src/modules/squads/errors';
import { SquadService } from '../../../packages/core-api/src/modules/squads/service';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';
import { asPrismaClient } from '../../support/prisma-double';
import { expectDefined } from '../../support/expect-defined';

/**
 * Team use cases — list, read, create, rename and re-icon, inactivate, add and remove owners —
 * against the in-memory league world. Each asserts what the league holds afterwards (who owns
 * which team, who is still a league member, what the team is called), not which repository
 * calls were made. Permanently deleting a team runs a Prisma transaction, so it is covered
 * against Postgres in the integration suite instead.
 */

interface TwoTeamLeague {
  world: InMemoryLeagueWorld;
  league: League;
  commissioner: User;
  commissionerSquad: Squad;
  owner: User;
  ownerSquad: Squad;
  service: SquadService;
}

/** A league with a commissioner on their own team and one member who owns a team alone. */
function leagueWithTwoTeams(): TwoTeamLeague {
  const world = inMemoryLeagueWorld();
  const league = world.addLeague({ name: 'Office Pool', leagueCode: 'OFFICE' });
  const commissioner = world.addUser({ firstName: 'Casey', lastName: 'Commish' });
  const owner = world.addUser({ firstName: 'Olive', lastName: 'Owner' });
  const { squad: commissionerSquad } = world.addMember({ league, user: commissioner, role: LeagueRole.COMMISSIONER });
  const { squad: ownerSquad } = world.addMember({ league, user: owner });
  const service = new SquadService({
    squads: world.squads,
    squadMemberships: world.squadMemberships,
    membershipTransaction: world.transaction,
    leagueMemberships: world.memberships,
    users: world.users,
    // Only `deleteInactiveSquad` reaches Prisma; these tests stop before its transaction.
    prisma: asPrismaClient({}),
    squadOwnerInvitations: world.ownerInvitations,
  });
  return { world, league, commissioner, commissionerSquad, owner, ownerSquad, service };
}

function ownersOf(world: InMemoryLeagueWorld, squadId: string): string[] {
  return world.tables.squadMemberships
    .where((row) => row.squadId === squadId && row.status === SquadMembershipStatus.ACTIVE)
    .map((row) => row.userId)
    .sort();
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SquadOperationError) {
      return error.code;
    }
    if (error instanceof SquadNotFoundError) {
      return 'SQUAD_NOT_FOUND';
    }
    throw error;
  }
  throw new Error('expected the operation to be rejected');
}

/** Seeds a league member with no team at all, the only state in which creating a team succeeds. */
function addMemberWithoutTeam(world: InMemoryLeagueWorld, league: League, user: User) {
  return world.tables.memberships.insert({
    leagueId: league.id,
    userId: user.id,
    role: LeagueRole.MEMBER,
    status: LeagueMembershipStatus.ACTIVE,
    joinedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
}

describe('Team use cases', () => {
  describe('listing and reading teams', () => {
    it('lists every team in the league, inactive ones included, each with its owners and active owner count', async () => {
      const { world, league, owner, ownerSquad, commissioner, service } = leagueWithTwoTeams();
      world.tables.squads.patch(ownerSquad.id, { isActive: false });

      const squads = await service.listSquads(league.id, commissioner.id);

      expect(squads.map((squad) => squad.id).sort()).toEqual(
        world.tables.squads.where(() => true).map((squad) => squad.id).sort(),
      );
      const listed = expectDefined(squads.find((squad) => squad.id === ownerSquad.id));
      expect(listed.isActive).toBe(false);
      expect(listed.memberCount).toBe(1);
      expect((listed.members ?? []).map((member) => member.user.id)).toEqual([owner.id]);
    });

    it('refuses to list a league\'s teams to someone who is not a member of it', async () => {
      const { world, league, service } = leagueWithTwoTeams();
      const outsider = world.addUser();

      await expect(rejectionCode(service.listSquads(league.id, outsider.id))).resolves.toBe('LEAGUE_MEMBERSHIP_REQUIRED');
    });

    it('refuses to list a league\'s teams to a member whose league membership has ended', async () => {
      const { world, league, owner, service } = leagueWithTwoTeams();
      const membership = expectDefined(world.membershipOf(league.id, owner.id));
      world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });

      await expect(rejectionCode(service.listSquads(league.id, owner.id))).resolves.toBe('LEAGUE_MEMBERSHIP_REQUIRED');
    });

    it('reads one team for a league member, counting only its active owners', async () => {
      const { world, league, owner, ownerSquad, commissioner, service } = leagueWithTwoTeams();
      const former = world.addUser({ firstName: 'Fran', lastName: 'Former' });
      world.addMember({ league, user: former, squadId: ownerSquad.id });
      const formerMembership = expectDefined(world.squadMembershipOf(league.id, former.id));
      world.tables.squadMemberships.patch(formerMembership.id, { status: SquadMembershipStatus.INACTIVE });

      const squad = await service.getSquad(league.id, ownerSquad.id, commissioner.id);

      expect(squad.name).toBe(ownerSquad.name);
      expect(squad.memberCount).toBe(1);
      expect((squad.members ?? []).map((member) => member.user.id).sort()).toEqual([former.id, owner.id].sort());
    });

    it('lets a root admin who is not in the league read one of its teams', async () => {
      const { world, league, ownerSquad, service } = leagueWithTwoTeams();
      const admin = world.addUser({ isRootAdmin: true });

      const squad = await service.getSquad(league.id, ownerSquad.id, admin.id, true);

      expect(squad.id).toBe(ownerSquad.id);
    });

    it('reports a team from another league as not found rather than reading it through this league', async () => {
      const { world, league, commissioner, service } = leagueWithTwoTeams();
      const otherLeague = world.addLeague();
      const stranger = world.addUser();
      const { squad: foreignSquad } = world.addMember({ league: otherLeague, user: stranger });

      await expect(rejectionCode(service.getSquad(league.id, foreignSquad.id, commissioner.id))).resolves.toBe('SQUAD_NOT_FOUND');
    });
  });

  describe('creating a team', () => {
    it('creates a team under the trimmed chosen name and icon, owned by its creator alone', async () => {
      const { world, league, service } = leagueWithTwoTeams();
      const newcomer = world.addUser({ firstName: 'Nia', lastName: 'New' });
      addMemberWithoutTeam(world, league, newcomer);

      const squad = await service.createSquad(league.id, newcomer.id, {
        name: '  Birdie Hunters  ',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      });

      expect(squad.name).toBe('Birdie Hunters');
      expect(squad.isActive).toBe(true);
      expect(ownersOf(world, squad.id)).toEqual([newcomer.id]);
      expect(world.tables.squads.get(squad.id)?.createdBy).toBe(newcomer.id);
    });

    it('names a team after its creator when no name is given, and gives it the default icon', async () => {
      const { world, league, service } = leagueWithTwoTeams();
      const newcomer = world.addUser({ firstName: 'Nia', lastName: 'New' });
      addMemberWithoutTeam(world, league, newcomer);

      const squad = await service.createSquad(league.id, newcomer.id, { name: '   ' });

      expect(squad.name).toBe("Nia New's Team");
      expect(squad.iconKey).toBe(TeamIconKey.CAPTAIN_SMILE_FIELD);
    });

    it('refuses a second team for a member who already owns an active one', async () => {
      const { league, owner, service } = leagueWithTwoTeams();

      await expect(rejectionCode(service.createSquad(league.id, owner.id, { name: 'Second Team' }))).resolves.toBe('SQUAD_MEMBERSHIP_CONFLICT');
    });

    it('refuses a new team for a member who already has a past team in the league, so their history is not split', async () => {
      const { world, league, owner, service } = leagueWithTwoTeams();
      const ownership = expectDefined(world.squadMembershipOf(league.id, owner.id));
      world.tables.squadMemberships.patch(ownership.id, { status: SquadMembershipStatus.INACTIVE });

      await expect(rejectionCode(service.createSquad(league.id, owner.id, { name: 'Fresh Start' }))).resolves.toBe('SQUAD_HISTORY_EXISTS');
      expect(world.tables.squads.where((squad) => squad.name === 'Fresh Start')).toEqual([]);
    });

    it('refuses to create a team for someone who is not a league member', async () => {
      const { world, league, service } = leagueWithTwoTeams();
      const outsider = world.addUser();

      await expect(rejectionCode(service.createSquad(league.id, outsider.id, {}))).resolves.toBe('LEAGUE_MEMBERSHIP_REQUIRED');
    });

    it('refuses a chosen name that an inactive team in the league still holds', async () => {
      const { world, league, ownerSquad, service } = leagueWithTwoTeams();
      world.tables.squads.patch(ownerSquad.id, { isActive: false });
      const newcomer = world.addUser();
      addMemberWithoutTeam(world, league, newcomer);

      await expect(rejectionCode(service.createSquad(league.id, newcomer.id, { name: ownerSquad.name }))).resolves.toBe('SQUAD_NAME_TAKEN');
    });
  });

  describe('renaming and re-iconing a team', () => {
    it('lets an owner rename their team, trimming the new name and keeping the icon', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();

      const squad = await service.updateSquad(league.id, ownerSquad.id, owner.id, { name: '  Eagle Eyes ' });

      expect(squad.name).toBe('Eagle Eyes');
      expect(world.tables.squads.get(ownerSquad.id)?.iconKey).toBe(ownerSquad.iconKey);
    });

    it('lets an owner change only the icon, leaving the name as it was', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();
      const otherIcon = expectDefined(Object.values(TeamIconKey).find((key) => key !== ownerSquad.iconKey));

      await service.updateSquad(league.id, ownerSquad.id, owner.id, { iconKey: otherIcon });

      expect(world.tables.squads.get(ownerSquad.id)).toMatchObject({ name: ownerSquad.name, iconKey: otherIcon });
    });

    it('refuses a name that is only spaces, leaving the team\'s name unchanged', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();

      await expect(rejectionCode(service.updateSquad(league.id, ownerSquad.id, owner.id, { name: '   ' }))).resolves.toBe('SQUAD_NAME_REQUIRED');
      expect(world.tables.squads.get(ownerSquad.id)?.name).toBe(ownerSquad.name);
    });

    it('refuses to let a member rename a team they do not own', async () => {
      const { world, league, commissionerSquad, owner, service } = leagueWithTwoTeams();

      await expect(rejectionCode(service.updateSquad(league.id, commissionerSquad.id, owner.id, { name: 'Hijacked' }))).resolves.toBe('SQUAD_OWNER_REQUIRED');
      expect(world.tables.squads.get(commissionerSquad.id)?.name).toBe(commissionerSquad.name);
    });

    it('refuses a rename by a former owner whose ownership has ended', async () => {
      const { world, league, ownerSquad, service } = leagueWithTwoTeams();
      const former = world.addUser();
      world.addMember({ league, user: former, squadId: ownerSquad.id });
      const formerOwnership = expectDefined(world.squadMembershipOf(league.id, former.id));
      world.tables.squadMemberships.patch(formerOwnership.id, { status: SquadMembershipStatus.INACTIVE });

      await expect(rejectionCode(service.updateSquad(league.id, ownerSquad.id, former.id, { name: 'Mine Again' }))).resolves.toBe('SQUAD_OWNER_REQUIRED');
    });

    it('lets a root admin who is not in the league rename a team', async () => {
      const { world, league, ownerSquad, service } = leagueWithTwoTeams();
      const admin = world.addUser({ isRootAdmin: true });

      await service.updateSquad(league.id, ownerSquad.id, admin.id, { name: 'Renamed By Admin' }, true);

      expect(world.tables.squads.get(ownerSquad.id)?.name).toBe('Renamed By Admin');
    });

    it('reports a rename of a team from another league as not found, even for a root admin', async () => {
      const { world, league, service } = leagueWithTwoTeams();
      const otherLeague = world.addLeague();
      const { squad: foreignSquad } = world.addMember({ league: otherLeague, user: world.addUser() });
      const admin = world.addUser({ isRootAdmin: true });

      await expect(rejectionCode(service.updateSquad(league.id, foreignSquad.id, admin.id, { name: 'X' }, true))).resolves.toBe('SQUAD_NOT_FOUND');
    });
  });

  describe('inactivating a team', () => {
    it('ends the team and every active owner\'s league membership when a commissioner inactivates it', async () => {
      const { world, league, commissioner, owner, ownerSquad, service } = leagueWithTwoTeams();
      const coOwner = world.addUser();
      world.addMember({ league, user: coOwner, squadId: ownerSquad.id });

      const squad = await service.inactivateSquad(league.id, ownerSquad.id, commissioner.id);

      expect(squad.isActive).toBe(false);
      expect(world.tables.squads.get(ownerSquad.id)?.isActive).toBe(false);
      expect(ownersOf(world, ownerSquad.id)).toEqual([]);
      expect(world.membershipOf(league.id, owner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
      expect(world.membershipOf(league.id, coOwner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
      expect(world.membershipOf(league.id, commissioner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    });

    it('revokes the team\'s pending co-owner invitations, so accepting an old invite cannot revive the team', async () => {
      const { world, league, commissioner, owner, ownerSquad, commissionerSquad, service } = leagueWithTwoTeams();
      const invite = (squadId: string, status: SquadOwnerInvitationStatus, code: string) =>
        world.tables.ownerInvitations.insert({
          leagueId: league.id,
          squadId,
          email: `${code}@example.com`,
          inviteCode: code,
          status,
          invitedBy: owner.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
      const pending = invite(ownerSquad.id, SquadOwnerInvitationStatus.PENDING, 'pending1');
      const accepted = invite(ownerSquad.id, SquadOwnerInvitationStatus.ACCEPTED, 'accepted1');
      const otherTeamPending = invite(commissionerSquad.id, SquadOwnerInvitationStatus.PENDING, 'pending2');

      await service.inactivateSquad(league.id, ownerSquad.id, commissioner.id);

      expect(world.tables.ownerInvitations.get(pending.id)?.status).toBe(SquadOwnerInvitationStatus.REVOKED);
      expect(world.tables.ownerInvitations.get(accepted.id)?.status).toBe(SquadOwnerInvitationStatus.ACCEPTED);
      expect(world.tables.ownerInvitations.get(otherTeamPending.id)?.status).toBe(SquadOwnerInvitationStatus.PENDING);
    });

    it('returns an already inactive team unchanged instead of failing', async () => {
      const { world, league, commissioner, ownerSquad, service } = leagueWithTwoTeams();
      world.tables.squads.patch(ownerSquad.id, { isActive: false });

      const squad = await service.inactivateSquad(league.id, ownerSquad.id, commissioner.id);

      expect(squad.isActive).toBe(false);
    });

    it('lets a root admin who is not in the league inactivate a team', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();
      const admin = world.addUser({ isRootAdmin: true });

      await service.inactivateSquad(league.id, ownerSquad.id, admin.id, true);

      expect(world.membershipOf(league.id, owner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
    });

    it('refuses to let the league\'s only commissioner inactivate their own team, which would leave nobody to run the league', async () => {
      const { world, league, commissioner, commissionerSquad, service } = leagueWithTwoTeams();

      await expect(rejectionCode(service.inactivateSquad(league.id, commissionerSquad.id, commissioner.id))).resolves.toBe('LEAGUE_LAST_COMMISSIONER_REQUIRED');
      expect(world.tables.squads.get(commissionerSquad.id)?.isActive).toBe(true);
      expect(world.membershipOf(league.id, commissioner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    });

    it('refuses to let a root admin inactivate the team of the league\'s only commissioner', async () => {
      const { world, league, commissioner, commissionerSquad, service } = leagueWithTwoTeams();
      const admin = world.addUser({ isRootAdmin: true });

      await expect(rejectionCode(service.inactivateSquad(league.id, commissionerSquad.id, admin.id, true))).resolves.toBe('LEAGUE_LAST_COMMISSIONER_REQUIRED');
      expect(world.membershipOf(league.id, commissioner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    });

    it('refuses to inactivate a team whose co-owners are every active commissioner the league has', async () => {
      const { world, league, commissioner, commissionerSquad, service } = leagueWithTwoTeams();
      const coCommissioner = world.addUser();
      world.addMember({ league, user: coCommissioner, role: LeagueRole.COMMISSIONER, squadId: commissionerSquad.id });

      await expect(rejectionCode(service.inactivateSquad(league.id, commissionerSquad.id, commissioner.id))).resolves.toBe('LEAGUE_LAST_COMMISSIONER_REQUIRED');
      expect(world.membershipOf(league.id, coCommissioner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    });

    it('lets a commissioner inactivate their own team when another active commissioner remains', async () => {
      const { world, league, commissioner, commissionerSquad, service } = leagueWithTwoTeams();
      world.addMember({ league, user: world.addUser(), role: LeagueRole.COMMISSIONER });

      await service.inactivateSquad(league.id, commissionerSquad.id, commissioner.id);

      expect(world.tables.squads.get(commissionerSquad.id)?.isActive).toBe(false);
      expect(world.membershipOf(league.id, commissioner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
    });

    it('refuses to let a plain member inactivate a team, their own included', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();

      await expect(rejectionCode(service.inactivateSquad(league.id, ownerSquad.id, owner.id))).resolves.toBe('LEAGUE_PERMISSION_DENIED');
      expect(world.tables.squads.get(ownerSquad.id)?.isActive).toBe(true);
    });
  });

  describe('adding a team owner directly', () => {
    it('refuses to add a league member who already owns another team', async () => {
      const { league, commissioner, owner, commissionerSquad, service } = leagueWithTwoTeams();

      await expect(rejectionCode(service.addOwner(league.id, commissionerSquad.id, commissioner.id, owner.id))).resolves.toBe('SQUAD_MEMBERSHIP_CONFLICT');
    });

    it('returns the existing ownership unchanged when the user already owns the team', async () => {
      const { world, league, commissioner, owner, ownerSquad, service } = leagueWithTwoTeams();

      const membership = await service.addOwner(league.id, ownerSquad.id, commissioner.id, owner.id);

      expect(membership.status).toBe(SquadMembershipStatus.ACTIVE);
      expect(ownersOf(world, ownerSquad.id)).toEqual([owner.id]);
    });

    it('makes a league member with no team an owner of the team', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();
      const newcomer = world.addUser();
      addMemberWithoutTeam(world, league, newcomer);

      const membership = await service.addOwner(league.id, ownerSquad.id, owner.id, newcomer.id);

      expect(membership.user.id).toBe(newcomer.id);
      expect(ownersOf(world, ownerSquad.id)).toEqual([owner.id, newcomer.id].sort());
    });

    it('restores a former owner of the team and reactivates the team if it had been inactivated', async () => {
      const { world, league, commissioner, ownerSquad, owner, service } = leagueWithTwoTeams();
      const ownership = expectDefined(world.squadMembershipOf(league.id, owner.id));
      world.tables.squadMemberships.patch(ownership.id, { status: SquadMembershipStatus.INACTIVE });
      world.tables.squads.patch(ownerSquad.id, { isActive: false });

      await service.addOwner(league.id, ownerSquad.id, commissioner.id, owner.id);

      expect(ownersOf(world, ownerSquad.id)).toEqual([owner.id]);
      expect(world.tables.squads.get(ownerSquad.id)?.isActive).toBe(true);
    });

    it('refuses to add someone who is not an active league member', async () => {
      const { world, league, commissioner, ownerSquad, service } = leagueWithTwoTeams();
      const outsider = world.addUser();

      await expect(rejectionCode(service.addOwner(league.id, ownerSquad.id, commissioner.id, outsider.id))).resolves.toBe('LEAGUE_MEMBERSHIP_REQUIRED');
    });
  });

  describe('removing a team owner', () => {
    it('removes a co-owner from the team and the league while the remaining owner keeps the team', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();
      const coOwner = world.addUser();
      world.addMember({ league, user: coOwner, squadId: ownerSquad.id });

      const membership = await service.removeOwner(league.id, ownerSquad.id, owner.id, coOwner.id);

      expect(membership.status).toBe(SquadMembershipStatus.INACTIVE);
      expect(ownersOf(world, ownerSquad.id)).toEqual([owner.id]);
      expect(world.tables.squads.get(ownerSquad.id)?.isActive).toBe(true);
      expect(world.membershipOf(league.id, coOwner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
    });

    it('reports removing someone who does not own the team as not found', async () => {
      const { league, commissioner, owner, commissionerSquad, service } = leagueWithTwoTeams();

      await expect(rejectionCode(service.removeOwner(league.id, commissionerSquad.id, commissioner.id, owner.id))).resolves.toBe('SQUAD_NOT_FOUND');
    });

    it('reports removing an owner whose ownership already ended as not found', async () => {
      const { world, league, owner, ownerSquad, service } = leagueWithTwoTeams();
      const former = world.addUser();
      world.addMember({ league, user: former, squadId: ownerSquad.id });
      const ownership = expectDefined(world.squadMembershipOf(league.id, former.id));
      world.tables.squadMemberships.patch(ownership.id, { status: SquadMembershipStatus.INACTIVE });

      await expect(rejectionCode(service.removeOwner(league.id, ownerSquad.id, owner.id, former.id))).resolves.toBe('SQUAD_NOT_FOUND');
    });

    it('refuses to let a member remove an owner from a team they do not own', async () => {
      const { world, league, owner, commissionerSquad, service } = leagueWithTwoTeams();
      const coOwner = world.addUser();
      world.addMember({ league, user: coOwner, squadId: commissionerSquad.id });

      await expect(rejectionCode(service.removeOwner(league.id, commissionerSquad.id, owner.id, coOwner.id))).resolves.toBe('SQUAD_OWNER_REQUIRED');
      expect(world.membershipOf(league.id, coOwner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    });
  });

  describe('permanently deleting a team', () => {
    it('refuses to delete a team that is still active, so a live team is never wiped', async () => {
      const { world, league, ownerSquad, service } = leagueWithTwoTeams();
      const admin = world.addUser({ isRootAdmin: true });

      await expect(rejectionCode(service.deleteInactiveSquad(league.id, ownerSquad.id, admin.id))).resolves.toBe('SQUAD_DELETE_REQUIRES_INACTIVE');
      expect(world.tables.squads.get(ownerSquad.id)).not.toBeNull();
    });

    it('reports deleting a team from another league as not found', async () => {
      const { world, league, service } = leagueWithTwoTeams();
      const otherLeague = world.addLeague();
      const { squad: foreignSquad } = world.addMember({ league: otherLeague, user: world.addUser() });
      world.tables.squads.patch(foreignSquad.id, { isActive: false });

      await expect(rejectionCode(service.deleteInactiveSquad(league.id, foreignSquad.id, 'admin'))).resolves.toBe('SQUAD_NOT_FOUND');
    });
  });
});

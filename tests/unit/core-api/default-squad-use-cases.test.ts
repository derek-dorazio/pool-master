import { expect } from '@jest/globals';
import { LeagueRole, LeagueMembershipStatus, SquadMembershipStatus, TeamIconKey } from '@poolmaster/shared/domain';
import {
  DefaultSquadProvisioningError,
  ensureDefaultSquadForLeagueMember,
} from '../../../packages/core-api/src/modules/squads/default-squad';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';
import { expectDefined } from '../../support/expect-defined';

/**
 * Default-team provisioning — what joining a league (or creating one) leaves a member owning.
 * Runs against the in-memory league world and asserts the stored teams and ownerships.
 */

function provision(world: InMemoryLeagueWorld, leagueId: string, userId: string) {
  return ensureDefaultSquadForLeagueMember({
    leagueId,
    userId,
    squadRepo: world.squads,
    squadMembershipRepo: world.squadMemberships,
    users: world.users,
  });
}

function joinWithoutTeam(world: InMemoryLeagueWorld, leagueId: string, userId: string) {
  world.tables.memberships.insert({
    leagueId,
    userId,
    role: LeagueRole.MEMBER,
    status: LeagueMembershipStatus.ACTIVE,
    joinedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
}

async function provisioningErrorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DefaultSquadProvisioningError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('expected provisioning to fail');
}

describe('Default team provisioning', () => {
  it('gives a new member their own active team named after them, with the default icon', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const user = world.addUser({ firstName: 'Dee', lastName: 'Dorazio' });
    joinWithoutTeam(world, league.id, user.id);

    const squad = await provision(world, league.id, user.id);

    expect(squad).toMatchObject({ name: "Dee Dorazio's Team", isActive: true, iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD });
    expect(world.squadMembershipOf(league.id, user.id)).toMatchObject({
      squadId: squad.id,
      status: SquadMembershipStatus.ACTIVE,
    });
  });

  it('numbers the default name when another team in the league already has it, rather than blocking the join', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const first = world.addUser({ firstName: 'Sam', lastName: 'Smith' });
    const second = world.addUser({ firstName: 'Sam', lastName: 'Smith' });
    joinWithoutTeam(world, league.id, first.id);
    joinWithoutTeam(world, league.id, second.id);

    await provision(world, league.id, first.id);
    const squad = await provision(world, league.id, second.id);

    expect(squad.name).toBe("Sam Smith's Team 2");
  });

  it('returns the team a member already owns instead of creating a second one', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const user = world.addUser();
    const { squad: existing } = world.addMember({ league, user });

    const squad = await provision(world, league.id, user.id);

    expect(squad.id).toBe(existing.id);
    expect(world.tables.squads.where((row) => row.leagueId === league.id)).toHaveLength(1);
  });

  it('fails loudly when an active ownership points at a team that no longer exists', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const user = world.addUser();
    const { squad } = world.addMember({ league, user });
    world.tables.squads.remove(squad.id);

    await expect(provisioningErrorCode(provision(world, league.id, user.id))).resolves.toBe('SQUAD_MEMBERSHIP_ORPHANED');
  });

  it('refuses to provision a team for a user with no last name, because the team cannot be named', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const user = world.addUser({ lastName: '' });
    joinWithoutTeam(world, league.id, user.id);

    await expect(provisioningErrorCode(provision(world, league.id, user.id))).resolves.toBe('SQUAD_OWNER_RESOLUTION_FAILED');
    expect(world.tables.squads.where(() => true)).toEqual([]);
  });

  it('restores a returning member to their original team, reactivating it, so their contest history stays with them', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const user = world.addUser();
    const { squad: original } = world.addMember({ league, user });
    const ownership = expectDefined(world.squadMembershipOf(league.id, user.id));
    world.tables.squadMemberships.patch(ownership.id, { status: SquadMembershipStatus.INACTIVE });
    world.tables.squads.patch(original.id, { isActive: false });

    const squad = await provision(world, league.id, user.id);

    expect(squad.id).toBe(original.id);
    expect(squad.isActive).toBe(true);
    expect(world.squadMembershipOf(league.id, user.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
  });

  it('restores a returning co-owner to their original team when it is still active, leaving the other owner in place', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const owner = world.addUser();
    const returning = world.addUser();
    const { squad: team } = world.addMember({ league, user: owner });
    world.addMember({ league, user: returning, squadId: team.id });
    const ownership = expectDefined(world.squadMembershipOf(league.id, returning.id));
    world.tables.squadMemberships.patch(ownership.id, { status: SquadMembershipStatus.INACTIVE });

    const squad = await provision(world, league.id, returning.id);

    expect(squad.id).toBe(team.id);
    expect(
      world.tables.squadMemberships
        .where((row) => row.squadId === team.id && row.status === SquadMembershipStatus.ACTIVE)
        .map((row) => row.userId)
        .sort(),
    ).toEqual([owner.id, returning.id].sort());
  });

  it('moves a returning member\'s ownership onto a new team when their original team is gone', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const user = world.addUser({ firstName: 'Ray', lastName: 'Turner' });
    const { squad: original } = world.addMember({ league, user });
    const ownership = expectDefined(world.squadMembershipOf(league.id, user.id));
    world.tables.squadMemberships.patch(ownership.id, { status: SquadMembershipStatus.INACTIVE });
    world.tables.squads.remove(original.id);

    const squad = await provision(world, league.id, user.id);

    expect(squad.id).not.toBe(original.id);
    expect(squad.name).toBe("Ray Turner's Team");
    expect(world.squadMembershipOf(league.id, user.id)).toMatchObject({
      id: ownership.id,
      squadId: squad.id,
      status: SquadMembershipStatus.ACTIVE,
    });
  });
});

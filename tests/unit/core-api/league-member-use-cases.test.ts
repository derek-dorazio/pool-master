import { expect } from '@jest/globals';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import { MemberDirectoryService } from '../../../packages/core-api/src/modules/leagues/member-directory-service';
import {
  MemberNotFoundError,
  MemberOperationError,
  MemberService,
} from '../../../packages/core-api/src/modules/leagues/member-service';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';
import { asPrismaClient } from '../../support/prisma-double';

/**
 * League membership use cases — role changes, removal, and the member roster — against the
 * in-memory league world. Removal is asserted through what it leaves stored: the league
 * membership, the squad membership, the squad, and the user's account.
 */

function memberService(world: InMemoryLeagueWorld, options: { withSquads?: boolean } = {}) {
  const withSquads = options.withSquads ?? true;
  return new MemberService(
    world.memberships,
    asPrismaClient({}),
    withSquads ? world.squads : undefined,
    withSquads ? world.squadMemberships : undefined,
  );
}

function leagueWithCommissioner() {
  const world = inMemoryLeagueWorld();
  const league = world.addLeague();
  const commissioner = world.addUser();
  world.addMember({ league, user: commissioner, role: LeagueRole.COMMISSIONER });
  return { world, league, commissioner };
}

describe('MemberService — changing roles', () => {
  it('promotes a member to COMMISSIONER', async () => {
    const { world, league } = leagueWithCommissioner();
    const member = world.addUser();
    world.addMember({ league, user: member });

    await memberService(world).changeRole({ leagueId: league.id, targetUserId: member.id, newRole: LeagueRole.COMMISSIONER });

    expect(world.membershipOf(league.id, member.id)?.role).toBe(LeagueRole.COMMISSIONER);
  });

  it('demotes a commissioner to MEMBER when another active commissioner remains', async () => {
    const { world, league, commissioner } = leagueWithCommissioner();
    const coCommissioner = world.addUser();
    world.addMember({ league, user: coCommissioner, role: LeagueRole.COMMISSIONER });

    await memberService(world).changeRole({ leagueId: league.id, targetUserId: commissioner.id, newRole: LeagueRole.MEMBER });

    expect(world.membershipOf(league.id, commissioner.id)?.role).toBe(LeagueRole.MEMBER);
  });

  it('refuses to demote the last active commissioner with LEAGUE_LAST_COMMISSIONER_REQUIRED, leaving the role unchanged', async () => {
    const { world, league, commissioner } = leagueWithCommissioner();

    const attempt = memberService(world).changeRole({
      leagueId: league.id,
      targetUserId: commissioner.id,
      newRole: LeagueRole.MEMBER,
    });

    await expect(attempt).rejects.toBeInstanceOf(MemberOperationError);
    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED' });
    expect(world.membershipOf(league.id, commissioner.id)?.role).toBe(LeagueRole.COMMISSIONER);
  });

  it('does not count a removed commissioner as the replacement that allows a demotion', async () => {
    const { world, league, commissioner } = leagueWithCommissioner();
    const formerCommissioner = world.addUser();
    const { membership } = world.addMember({ league, user: formerCommissioner, role: LeagueRole.COMMISSIONER });
    world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });

    await expect(memberService(world).changeRole({
      leagueId: league.id,
      targetUserId: commissioner.id,
      newRole: LeagueRole.MEMBER,
    })).rejects.toMatchObject({ code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED' });
  });

  it('lets the last commissioner "change" to COMMISSIONER, since that removes no commissioner', async () => {
    const { world, league, commissioner } = leagueWithCommissioner();

    await expect(memberService(world).changeRole({
      leagueId: league.id,
      targetUserId: commissioner.id,
      newRole: LeagueRole.COMMISSIONER,
    })).resolves.toMatchObject({ role: LeagueRole.COMMISSIONER });
  });

  it('refuses a role change for someone who never joined with MemberNotFoundError', async () => {
    const { world, league } = leagueWithCommissioner();

    const attempt = memberService(world).changeRole({ leagueId: league.id, targetUserId: 'stranger', newRole: LeagueRole.MEMBER });

    await expect(attempt).rejects.toBeInstanceOf(MemberNotFoundError);
    await expect(attempt).rejects.toThrow(`Member stranger not found in league ${league.id}`);
  });

  it('refuses a role change for a removed member with LEAGUE_MEMBER_INACTIVE', async () => {
    const { world, league } = leagueWithCommissioner();
    const former = world.addUser();
    const { membership } = world.addMember({ league, user: former });
    world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });

    await expect(memberService(world).changeRole({
      leagueId: league.id,
      targetUserId: former.id,
      newRole: LeagueRole.COMMISSIONER,
    })).rejects.toMatchObject({ code: 'LEAGUE_MEMBER_INACTIVE' });
    expect(world.membershipOf(league.id, former.id)?.role).toBe(LeagueRole.MEMBER);
  });
});

describe('MemberService — removing a member', () => {
  it('ends the league and squad membership and inactivates a team the member owned alone, but leaves their account active', async () => {
    const { world, league } = leagueWithCommissioner();
    const member = world.addUser();
    const { squad } = world.addMember({ league, user: member });

    await memberService(world).removeMember(league.id, member.id);

    expect(world.membershipOf(league.id, member.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
    expect(world.squadMembershipOf(league.id, member.id)?.status).toBe(SquadMembershipStatus.INACTIVE);
    expect(world.tables.squads.get(squad.id)?.isActive).toBe(false);
    expect(world.tables.users.get(member.id)?.isActive).toBe(true);
  });

  it('keeps a co-owned team active for its remaining owner when one co-owner is removed', async () => {
    const { world, league } = leagueWithCommissioner();
    const owner = world.addUser();
    const coOwner = world.addUser();
    const { squad } = world.addMember({ league, user: owner });
    world.addMember({ league, user: coOwner, squadId: squad.id });

    await memberService(world).removeMember(league.id, coOwner.id);

    expect(world.tables.squads.get(squad.id)?.isActive).toBe(true);
    expect(world.squadMembershipOf(league.id, owner.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
  });

  it('removes a commissioner when another active commissioner remains', async () => {
    const { world, league, commissioner } = leagueWithCommissioner();
    world.addMember({ league, user: world.addUser(), role: LeagueRole.COMMISSIONER });

    await memberService(world).removeMember(league.id, commissioner.id);

    expect(world.membershipOf(league.id, commissioner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });

  it('refuses to remove the last active commissioner, leaving their membership and team untouched', async () => {
    const { world, league, commissioner } = leagueWithCommissioner();

    await expect(memberService(world).removeMember(league.id, commissioner.id))
      .rejects.toMatchObject({ code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED' });
    expect(world.membershipOf(league.id, commissioner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(world.squadMembershipOf(league.id, commissioner.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
  });

  it('refuses to remove someone already removed with LEAGUE_MEMBER_ALREADY_INACTIVE', async () => {
    const { world, league } = leagueWithCommissioner();
    const member = world.addUser();
    world.addMember({ league, user: member });
    const service = memberService(world);
    await service.removeMember(league.id, member.id);

    await expect(service.removeMember(league.id, member.id))
      .rejects.toMatchObject({ code: 'LEAGUE_MEMBER_ALREADY_INACTIVE' });
  });

  it('refuses to remove someone who never joined with MemberNotFoundError', async () => {
    const { world, league } = leagueWithCommissioner();
    await expect(memberService(world).removeMember(league.id, 'stranger')).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it('ends only the league membership when squad repositories are not wired', async () => {
    const { world, league } = leagueWithCommissioner();
    const member = world.addUser();
    world.addMember({ league, user: member });

    await memberService(world, { withSquads: false }).removeMember(league.id, member.id);

    expect(world.membershipOf(league.id, member.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
    expect(world.squadMembershipOf(league.id, member.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
  });

  it('ends the league membership of a member whose team membership is already gone', async () => {
    const { world, league } = leagueWithCommissioner();
    const member = world.addUser();
    world.addMember({ league, user: member });
    const squadMembership = world.squadMembershipOf(league.id, member.id)!;
    world.tables.squadMemberships.remove(squadMembership.id);

    await memberService(world).removeMember(league.id, member.id);

    expect(world.membershipOf(league.id, member.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });
});

describe('MemberDirectoryService — the league roster', () => {
  it('lists only active members, earliest joiner first, each with their user embedded', async () => {
    const world = inMemoryLeagueWorld();
    const league = world.addLeague();
    const [early, late, removed] = [
      world.addUser({ firstName: 'Early' }),
      world.addUser({ firstName: 'Late' }),
      world.addUser({ firstName: 'Removed' }),
    ];
    const { membership: lateMembership } = world.addMember({ league, user: late });
    const { membership: earlyMembership } = world.addMember({ league, user: early });
    const { membership: removedMembership } = world.addMember({ league, user: removed });
    world.tables.memberships.patch(lateMembership.id, { joinedAt: new Date('2026-09-10T00:00:00.000Z') });
    world.tables.memberships.patch(earlyMembership.id, { joinedAt: new Date('2026-09-02T00:00:00.000Z') });
    world.tables.memberships.patch(removedMembership.id, { status: LeagueMembershipStatus.INACTIVE });

    const roster = await new MemberDirectoryService(world.memberships, world.users).listMembers(league.id);

    expect(roster.map((entry) => entry.user.firstName)).toEqual(['Early', 'Late']);
    expect(roster[0]).toMatchObject({
      leagueId: league.id,
      userId: early.id,
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: '2026-09-02T00:00:00.000Z',
    });
  });

  it('returns an empty roster for a league with no members', async () => {
    const world = inMemoryLeagueWorld();
    await expect(new MemberDirectoryService(world.memberships, world.users).listMembers(world.addLeague().id))
      .resolves.toEqual([]);
  });
});

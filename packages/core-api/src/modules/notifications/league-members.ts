import type { LeagueMembershipRepository, UserRepository } from '@poolmaster/shared/db';
import type { LeagueRole, User } from '@poolmaster/shared/domain';

export interface LeagueMemberDeps {
  memberships: Pick<LeagueMembershipRepository, 'findByLeague'>;
  users: Pick<UserRepository, 'findActiveByLeague'>;
}

/**
 * The people a league email goes to: the league's active members whose accounts are active,
 * each once, commissioners included.
 */
export async function activeLeagueMembers(deps: LeagueMemberDeps, leagueId: string): Promise<User[]> {
  return (await activeLeagueMembersWithRoles(deps, leagueId)).map(({ user }) => user);
}

/** The same people, each with their role in the league, for an email commissioners get too. */
export async function activeLeagueMembersWithRoles(
  deps: LeagueMemberDeps,
  leagueId: string,
): Promise<Array<{ user: User; role: LeagueRole }>> {
  const [memberships, users] = await Promise.all([
    deps.memberships.findByLeague(leagueId),
    deps.users.findActiveByLeague(leagueId),
  ]);
  const roles = new Map(memberships.map((membership) => [membership.userId, membership.role]));
  return users.flatMap((user) => {
    const role = roles.get(user.id);
    return user.isActive && role !== undefined ? [{ user, role }] : [];
  });
}

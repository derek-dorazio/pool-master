import type { LeagueMembershipRepository, UserRepository } from '@poolmaster/shared/db';
import { LeagueMembershipStatus, type User } from '@poolmaster/shared/domain';

export interface LeagueMemberDeps {
  memberships: Pick<LeagueMembershipRepository, 'findByLeague'>;
  users: Pick<UserRepository, 'findByLeague'>;
}

/**
 * The people a league email goes to: the league's active members whose accounts are active,
 * each once, commissioners included.
 */
export async function activeLeagueMembers(deps: LeagueMemberDeps, leagueId: string): Promise<User[]> {
  const [memberships, users] = await Promise.all([
    deps.memberships.findByLeague(leagueId),
    deps.users.findByLeague(leagueId),
  ]);
  const active = new Set(memberships
    .filter((membership) => membership.status === LeagueMembershipStatus.ACTIVE)
    .map((membership) => membership.userId));
  return users.filter((user) => user.isActive && active.has(user.id));
}

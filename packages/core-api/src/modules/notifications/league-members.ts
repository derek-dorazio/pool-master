import type { LeagueMembershipRepository, UserRepository } from '@poolmaster/shared/db';
import { LeagueRole, type LeagueMembership, type User } from '@poolmaster/shared/domain';

export interface LeagueMemberDeps {
  memberships: Pick<LeagueMembershipRepository, 'findByLeagues'>;
  users: Pick<UserRepository, 'findActiveByLeagues'>;
}

/** A league member a league email goes to, with their role in the league. */
export interface LeagueMemberWithRole {
  user: User;
  role: LeagueRole;
}

/**
 * The people a league email goes to: the league's active members whose accounts are active,
 * each once, commissioners included.
 */
export async function activeLeagueMembers(deps: LeagueMemberDeps, leagueId: string): Promise<User[]> {
  return (await activeLeagueMembersWithRoles(deps, leagueId)).map(({ user }) => user);
}

/** The same people, each with their role in the league, for an email commissioners get too. */
export async function activeLeagueMembersWithRoles(deps: LeagueMemberDeps, leagueId: string): Promise<LeagueMemberWithRole[]> {
  return (await activeLeagueMembersByLeague(deps, [leagueId])).get(leagueId) ?? [];
}

/**
 * The same people for several leagues, by league, in two reads whatever the number of leagues
 * (#1255): a sweep or an event-wide email reads every league it tells at once. Each league's
 * people come in the users read's order; a league with none has an empty list. Given `roles`,
 * only the members holding one of them are read (#1336).
 */
export async function activeLeagueMembersByLeague(
  deps: LeagueMemberDeps,
  leagueIds: readonly string[],
  roles?: readonly LeagueRole[],
): Promise<Map<string, LeagueMemberWithRole[]>> {
  const ids = [...new Set(leagueIds)];
  if (ids.length === 0) return new Map();
  const [memberships, users] = await Promise.all([
    deps.memberships.findByLeagues(ids, roles),
    deps.users.findActiveByLeagues(ids, roles),
  ]);
  return leagueMembersOf(ids, memberships, users);
}

/**
 * `activeLeagueMembersByLeague` from rows already read: `memberships` the leagues' active
 * memberships and `users` their accounts. For a caller that needed the memberships first (#1355).
 */
export function leagueMembersOf(
  leagueIds: readonly string[],
  memberships: readonly LeagueMembership[],
  users: readonly User[],
): Map<string, LeagueMemberWithRole[]> {
  const byLeague = new Map([...new Set(leagueIds)].map((leagueId): [string, LeagueMemberWithRole[]] => [leagueId, []]));
  const membershipsByUser = new Map<string, LeagueMembership[]>();
  for (const membership of memberships) {
    membershipsByUser.set(membership.userId, [...(membershipsByUser.get(membership.userId) ?? []), membership]);
  }
  for (const user of users) {
    if (!user.isActive) continue;
    for (const { leagueId, role } of membershipsByUser.get(user.id) ?? []) byLeague.get(leagueId)?.push({ user, role });
  }
  return byLeague;
}

/**
 * Each league's commissioners whose accounts are active, by league, reading no other member
 * (#1336): for the emails only commissioners get.
 */
export async function activeCommissionersByLeague(deps: LeagueMemberDeps, leagueIds: readonly string[]): Promise<Map<string, User[]>> {
  const byLeague = await activeLeagueMembersByLeague(deps, leagueIds, [LeagueRole.COMMISSIONER]);
  return new Map([...byLeague].map(([leagueId, members]) => [leagueId, members.map(({ user }) => user)]));
}

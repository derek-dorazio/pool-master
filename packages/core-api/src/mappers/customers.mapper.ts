/**
 * Customers mapper (#1882): a league and a user as the root admin's Customers grids show them.
 */
import type { CustomerLeagueDto, CustomerUserDto } from '@poolmaster/shared/dto';
import type { CustomerLeague, CustomerUser } from '@poolmaster/shared/domain';

export function toCustomerLeagueDto(league: CustomerLeague): CustomerLeagueDto {
  return {
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    isActive: league.isActive,
    plan: league.plan,
    owner: league.owner === null ? null : { userId: league.owner.userId, firstName: league.owner.firstName, lastName: league.owner.lastName },
    memberCount: league.memberCount,
    activeContestCount: league.activeContestCount,
    previewEndsAt: league.previewEndsAt?.toISOString() ?? null,
    createdAt: league.createdAt.toISOString(),
  };
}

export function toCustomerUserDto(user: CustomerUser): CustomerUserDto {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isRootAdmin: user.isRootAdmin,
    isActive: user.isActive,
    leagues: user.leagues.map((league) => ({ id: league.id, leagueCode: league.leagueCode, name: league.name })),
    joinedAt: user.joinedAt.toISOString(),
    lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
  };
}

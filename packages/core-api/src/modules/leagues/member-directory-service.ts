import { LeagueMembershipStatus } from '@poolmaster/shared/domain';
import type { LeagueMembershipRepository, UserRepository } from '@poolmaster/shared/db';
import type { LeagueMembershipDto } from '@poolmaster/shared/dto';
import { mapLeagueMembershipToDto } from '../../mappers/leagues-extra.mapper';

/**
 * The league member roster (#202 step 3.4).
 *
 * This service had no ports: it was a raw `prisma.leagueMembership.findMany` with a nested
 * user select, flattened into `LeagueMemberDto` — the edge with three of the user's columns
 * on it and the rest thrown away. It now composes the two ports the roster actually needs
 * and returns the canonical edge with the canonical `UserDto` embedded.
 *
 * `UserRepository.findByLeague` is the scoped peer read access rules A4 and A6 require: the
 * league join IS the scope, so there is no way to call it unscoped.
 */
export class MemberDirectoryService {
  constructor(
    private readonly memberships: LeagueMembershipRepository,
    private readonly users: UserRepository,
  ) {}

  async listMembers(leagueId: string): Promise<LeagueMembershipDto[]> {
    const [memberships, users] = await Promise.all([
      this.memberships.findByLeague(leagueId),
      this.users.findByLeague(leagueId),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));

    return memberships
      .filter((membership) => membership.status === LeagueMembershipStatus.ACTIVE)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .flatMap((membership) => {
        const user = userById.get(membership.userId);
        // findByLeague draws both sides from the same join, so a membership without a user
        // cannot occur; flatMap rather than map keeps that impossible case from needing a
        // fabricated user.
        return user ? [mapLeagueMembershipToDto(membership, user)] : [];
      });
  }
}

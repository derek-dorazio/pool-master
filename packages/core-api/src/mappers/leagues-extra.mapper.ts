import type { LeagueMembership, User } from '@poolmaster/shared/domain';
import type { LeagueMembershipDto } from '@poolmaster/shared/dto';
import { toUserDto } from './users.mapper';

/**
 * The User↔League edge → DTO.
 *
 * #202 step 3.4 — takes the member, because the edge embeds the canonical `UserDto`. That is
 * what replaced `LeagueMemberDto`, which flattened three of the user's columns onto the edge
 * and dropped the rest.
 *
 * The return type is declared. It was inferred, which meant the shape was held together only
 * by the serializer dropping unknown fields: `LeagueMembershipDto` was a registered component
 * with nothing type-checked against it, so a field added to the schema or dropped from here
 * compiled either way.
 */
export function mapLeagueMembershipToDto(
  membership: LeagueMembership,
  user: User,
): LeagueMembershipDto {
  return {
    id: membership.id,
    leagueId: membership.leagueId,
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
    user: toUserDto(user),
  };
}

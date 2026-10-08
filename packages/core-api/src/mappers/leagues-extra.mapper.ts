import type { LeagueInvitation, LeagueMembership, User } from '@poolmaster/shared/domain';
import type { LeagueInvitationDto, LeagueMembershipDto } from '@poolmaster/shared/dto';
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

/** A league invitation → DTO. Email and join-link invitations share the one shape. */
export function mapLeagueInvitationToDto(invitation: LeagueInvitation): LeagueInvitationDto {
  return {
    id: invitation.id,
    leagueId: invitation.leagueId,
    email: invitation.email ?? null,
    inviteCode: invitation.inviteCode,
    inviteType: invitation.inviteType,
    status: invitation.status,
    maxUses: invitation.maxUses,
    currentUses: invitation.currentUses,
    invitedBy: invitation.invitedBy,
    expiresAt: invitation.expiresAt?.toISOString() ?? null,
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    acceptedBy: invitation.acceptedBy ?? null,
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
  };
}

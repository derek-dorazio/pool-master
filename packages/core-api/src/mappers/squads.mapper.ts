import type { SquadDetails } from '@poolmaster/shared/db';
import { SquadMembershipStatus, type SquadMembership, type User } from '@poolmaster/shared/domain';
import type { SquadDto, SquadMembershipDto } from '@poolmaster/shared/dto';
import { toUserDto } from './users.mapper';

/**
 * #202 step 3.4 — takes the member rather than two loose name strings. The edge embeds the
 * canonical `UserDto`; `firstName`/`lastName` were optional on the DTO, so every consumer had
 * to handle a member whose name was simply absent.
 */
export function toSquadMembershipDto(
  membership: SquadMembership,
  user: User,
): SquadMembershipDto {
  return {
    id: membership.id,
    squadId: membership.squadId,
    leagueId: membership.leagueId,
    userId: membership.userId,
    user: toUserDto(user),
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}

/**
 * #202 step 3.4 — no viewer options bag. `teamRelationship` and `isRootAdmin` came off
 * `SquadDto` under access rule A8, and they were the only reason this took one.
 *
 * #1165 — takes the squad as one read with its owners, so the members and their count come
 * from the same rows. `memberCount` counts the ACTIVE owners; `members` lists every one.
 */
export function toSquadDetailsDto(squad: SquadDetails): SquadDto {
  return {
    id: squad.id,
    leagueId: squad.leagueId,
    createdBy: squad.createdBy,
    name: squad.name,
    iconKey: squad.iconKey,
    isActive: squad.isActive,
    memberCount: squad.members.filter(({ membership }) => membership.status === SquadMembershipStatus.ACTIVE).length,
    createdAt: squad.createdAt.toISOString(),
    updatedAt: squad.updatedAt.toISOString(),
    members: squad.members.map(({ membership, user }) => toSquadMembershipDto(membership, user)),
  };
}

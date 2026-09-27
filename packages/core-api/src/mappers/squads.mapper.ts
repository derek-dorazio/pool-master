import type { Squad, SquadMembership, User } from '@poolmaster/shared/domain';
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
 */
export function toSquadDto(
  squad: Squad,
  memberCount: number,
  members?: SquadMembershipDto[],
): SquadDto {
  return {
    id: squad.id,
    leagueId: squad.leagueId,
    createdBy: squad.createdBy,
    name: squad.name,
    iconKey: squad.iconKey,
    isActive: squad.isActive,
    memberCount,
    createdAt: squad.createdAt.toISOString(),
    updatedAt: squad.updatedAt.toISOString(),
    ...(members ? { members } : {}),
  };
}

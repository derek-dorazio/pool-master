import type { Squad, SquadMembership } from '@poolmaster/shared/domain';
import type { SquadDto, SquadMembershipDto } from '@poolmaster/shared/dto';

export function toSquadMembershipDto(
  membership: SquadMembership,
  firstName?: string,
  lastName?: string,
): SquadMembershipDto {
  return {
    id: membership.id,
    squadId: membership.squadId,
    leagueId: membership.leagueId,
    userId: membership.userId,
    firstName,
    lastName,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}

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
    iconUrl: squad.iconUrl ?? null,
    status: squad.status,
    memberCount,
    createdAt: squad.createdAt.toISOString(),
    updatedAt: squad.updatedAt.toISOString(),
    ...(members ? { members } : {}),
  };
}

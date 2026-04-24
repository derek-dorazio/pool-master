import type { Squad, SquadMembership } from '@poolmaster/shared/domain';
import type { SquadDto, SquadMembershipDto, TeamRelationshipDto } from '@poolmaster/shared/dto';

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
  opts?: {
    teamRelationship?: TeamRelationshipDto;
    isRootAdmin?: boolean;
  },
): SquadDto {
  return {
    id: squad.id,
    leagueId: squad.leagueId,
    createdBy: squad.createdBy,
    name: squad.name,
    iconKey: squad.iconKey,
    status: squad.status,
    memberCount,
    createdAt: squad.createdAt.toISOString(),
    updatedAt: squad.updatedAt.toISOString(),
    teamRelationship: opts?.teamRelationship ?? {
      leagueMember: false,
      owner: false,
      commissioner: false,
    },
    isRootAdmin: opts?.isRootAdmin ?? false,
    ...(members ? { members } : {}),
  };
}

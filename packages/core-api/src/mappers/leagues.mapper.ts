/**
 * League mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  LeagueSummaryDto,
  LeagueDetailDto,
  LeagueListResponse,
  LeagueRelationshipDto,
} from '@poolmaster/shared/dto';
import type { JoinPolicy, LeagueIconKey, LeagueRole } from '@poolmaster/shared/domain';

interface LeagueRow {
  id: string;
  leagueCode: string;
  name: string;
  description?: string | null;
  createdBy: string;
  isActive: boolean;
  iconKey: LeagueIconKey;
  joinPolicy: JoinPolicy;
  createdAt: Date;
  updatedAt: Date;
}

export function toLeagueSummaryDto(
  league: LeagueRow,
  opts?: {
    memberCount?: number;
    activeContestCount?: number;
    memberType?: LeagueRole | null;
    leagueRelationship?: LeagueRelationshipDto;
    isRootAdmin?: boolean;
  },
): LeagueSummaryDto {
  const memberType = opts?.memberType ?? null;
  const leagueRelationship = opts?.leagueRelationship ?? {
    leagueMember: memberType !== null,
    commissioner: memberType === 'COMMISSIONER',
  };

  return {
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    description: league.description ?? null,
    isActive: league.isActive,
    iconKey: league.iconKey,
    memberCount: opts?.memberCount ?? 0,
    activeContestCount: opts?.activeContestCount ?? 0,
    memberType,
    leagueRelationship,
    isRootAdmin: opts?.isRootAdmin ?? false,
    createdAt: league.createdAt.toISOString(),
  };
}

export function toLeagueDetailDto(
  league: LeagueRow,
  opts?: {
    memberCount?: number;
    activeContestCount?: number;
    memberType?: LeagueRole | null;
    leagueRelationship?: LeagueRelationshipDto;
    isRootAdmin?: boolean;
  },
): LeagueDetailDto {
  return {
    ...toLeagueSummaryDto(league, opts),
    joinPolicy: league.joinPolicy,
  };
}

export function toLeagueListResponse(
  leagues: LeagueRow[],
): LeagueListResponse {
  return {
    leagues: leagues.map((league) => toLeagueSummaryDto(league)),
  };
}

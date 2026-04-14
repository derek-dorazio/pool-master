/**
 * League mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  LeagueSummaryDto,
  LeagueDetailDto,
  LeagueListResponse,
} from '@poolmaster/shared/dto';
import type { JoinPolicy, LeagueRole, LeagueVisibility } from '@poolmaster/shared/domain';

interface LeagueRow {
  id: string;
  leagueCode: string;
  name: string;
  description?: string | null;
  createdBy: string;
  isActive: boolean;
  joinPolicy: JoinPolicy;
  visibility: LeagueVisibility;
  maxMembers: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toLeagueSummaryDto(
  league: LeagueRow,
  opts?: { memberCount?: number; activeContestCount?: number; role?: LeagueRole },
): LeagueSummaryDto {
  return {
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    description: league.description ?? null,
    visibility: league.visibility,
    isActive: league.isActive,
    memberCount: opts?.memberCount ?? 0,
    activeContestCount: opts?.activeContestCount ?? 0,
    role: opts?.role,
    createdAt: league.createdAt.toISOString(),
  };
}

export function toLeagueDetailDto(
  league: LeagueRow,
  opts?: { memberCount?: number; activeContestCount?: number; role?: LeagueRole },
): LeagueDetailDto {
  return {
    ...toLeagueSummaryDto(league, opts),
    maxMembers: league.maxMembers,
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

/**
 * League mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  LeagueSummaryDto,
  LeagueDetailDto,
  LeagueListResponse,
} from '@poolmaster/shared/dto';
import type { LeagueSettings } from '@poolmaster/shared/domain';

interface LeagueRow {
  id: string;
  leagueCode: string;
  name: string;
  description?: string | null;
  createdBy: string;
  visibility: string;
  maxMembers: number;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export function toLeagueSummaryDto(
  league: LeagueRow,
  opts?: { memberCount?: number; activeContestCount?: number; role?: string },
): LeagueSummaryDto {
  return {
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    description: league.description ?? null,
    visibility: league.visibility,
    memberCount: opts?.memberCount ?? 0,
    activeContestCount: opts?.activeContestCount ?? 0,
    role: opts?.role,
    createdAt: league.createdAt.toISOString(),
  };
}

export function toLeagueDetailDto(
  league: LeagueRow,
  opts?: { memberCount?: number; activeContestCount?: number; role?: string },
): LeagueDetailDto {
  const settings = league.settings as unknown as LeagueSettings | undefined;
  return {
    ...toLeagueSummaryDto(league, opts),
    maxMembers: league.maxMembers,
    settings: league.settings,
    invitePolicy: settings?.invitePolicy,
  };
}

export function toLeagueListResponse(
  leagues: LeagueRow[],
): LeagueListResponse {
  return {
    leagues: leagues.map((league) => toLeagueSummaryDto(league)),
  };
}

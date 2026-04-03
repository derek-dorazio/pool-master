/**
 * Contest mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  ContestSummaryDto,
  ContestDetailDto,
  ContestResponse,
  ContestListResponse,
} from '@poolmaster/shared/dto';
import type { SelectionConfig } from '@poolmaster/shared/domain';

interface ContestRow {
  id: string;
  leagueId: string;
  seasonId?: string | null;
  name: string;
  status: string;
  contestType: string;
  selectionType: string;
  scoringEngine: string;
  isExclusive: boolean;
  scoringStopsOnElimination: boolean;
  scoringRules: unknown;
  startsAt?: Date | null;
  endsAt?: Date | null;
  lockAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toContestSummaryDto(
  contest: ContestRow,
  opts?: { entryCount?: number },
): ContestSummaryDto {
  return {
    id: contest.id,
    name: contest.name,
    status: contest.status,
    contestType: contest.contestType,
    selectionType: contest.selectionType,
    scoringEngine: contest.scoringEngine,
    leagueId: contest.leagueId,
    entryCount: opts?.entryCount,
    startsAt: contest.startsAt?.toISOString() ?? null,
    endsAt: contest.endsAt?.toISOString() ?? null,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
  };
}

export function toContestDetailDto(
  contest: ContestRow,
  _selectionConfig?: SelectionConfig | null,
): ContestDetailDto {
  return {
    ...toContestSummaryDto(contest),
    scoringRules: (contest.scoringRules ?? {}) as Record<string, unknown>,
    lockAt: contest.lockAt?.toISOString() ?? null,
    isExclusive: contest.isExclusive,
  };
}

export function toContestResponse(
  contest: ContestRow,
  selectionConfig?: SelectionConfig | null,
): ContestResponse {
  return {
    contest: toContestDetailDto(contest, selectionConfig),
    selectionConfig: selectionConfig
      ? (selectionConfig as unknown as Record<string, unknown>)
      : null,
  };
}

export function toContestListResponse(
  contests: ContestRow[],
): ContestListResponse {
  return {
    contests: contests.map((c) => toContestSummaryDto(c)),
  };
}

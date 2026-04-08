/**
 * Contest mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  ContestSummaryDto,
  ContestDetailDto,
  ContestResponse,
  ContestListResponse,
  ContestEntryDto,
  ContestEntryListResponse,
  ContestEntryResponse,
  MyContestEntryResponse,
} from '@poolmaster/shared/dto';
import type { ContestConfiguration } from '@poolmaster/shared/domain';

interface ContestRow {
  id: string;
  leagueId: string;
  seasonId?: string | null;
  sportEventId?: string | null;
  name: string;
  status: string;
  contestType: string;
  selectionType: string;
  scoringEngine: string;
  sport?: string | null;
  isExclusive: boolean;
  scoringStopsOnElimination: boolean;
  scoringRules: unknown;
  startsAt?: Date | null;
  endsAt?: Date | null;
  lockAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContestEntryRow {
  id: string;
  contestId: string;
  squadId: string;
  entryNumber: number;
  name: string;
  status: string;
  totalScore: number;
  standingsPosition?: number | null;
  isEliminated: boolean;
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
    sportEventId: contest.sportEventId ?? null,
    sport: contest.sport ?? null,
    entryCount: opts?.entryCount,
    startsAt: contest.startsAt?.toISOString() ?? null,
    endsAt: contest.endsAt?.toISOString() ?? null,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
  };
}

export function toContestDetailDto(
  contest: ContestRow,
  _contestConfiguration?: ContestConfiguration | null,
): ContestDetailDto {
  return {
    ...toContestSummaryDto(contest),
    scoringRules: (contest.scoringRules ?? {}) as Record<string, unknown>,
    lockAt: contest.lockAt?.toISOString() ?? null,
    isExclusive: contest.isExclusive,
    sport: contest.sport ?? null,
  };
}

export function toContestResponse(
  contest: ContestRow,
  contestConfiguration?: ContestConfiguration | null,
): ContestResponse {
  return {
    contest: toContestDetailDto(contest, contestConfiguration),
    contestConfiguration: contestConfiguration
      ? (contestConfiguration as unknown as Record<string, unknown>)
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

export function toContestEntryDto(
  entry: ContestEntryRow,
  squad: { name: string },
): ContestEntryDto {
  return {
    id: entry.id,
    contestId: entry.contestId,
    squadId: entry.squadId,
    squadName: squad.name,
    entryNumber: entry.entryNumber,
    name: entry.name,
    status: entry.status as ContestEntryDto['status'],
    totalScore: entry.totalScore,
    standingsPosition: entry.standingsPosition ?? null,
    isEliminated: entry.isEliminated,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export function toContestEntryResponse(contestId: string, entry: ContestEntryDto): ContestEntryResponse {
  return { contestId, entry };
}

export function toContestEntryListResponse(input: {
  contestId: string;
  entries: ContestEntryDto[];
  isJoined: boolean;
  myEntryId: string | null;
  myEntryIds?: string[];
}): ContestEntryListResponse {
  return {
    contestId: input.contestId,
    total: input.entries.length,
    isJoined: input.isJoined,
    myEntryId: input.myEntryId,
    myEntryIds: input.myEntryIds,
    entries: input.entries,
  };
}

export function toMyContestEntryResponse(
  contestId: string,
  entry: ContestEntryDto | null,
): MyContestEntryResponse {
  return { contestId, entry };
}

/**
 * Contest mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  ContestSummaryDto,
  ContestDetailDto,
  ContestResponse,
  ContestConfigurationDetailDto,
  ContestListResponse,
  ContestEntryDto,
  ContestEntryDetailDto,
  ContestEntryParticipantDetailDto,
  ContestEntryListResponse,
  ContestEntryDetailResponse,
  ContestEntryResponse,
  MyContestEntryResponse,
} from '@poolmaster/shared/dto';
import type {
  Contest,
  ContestConfiguration,
  ContestEntry,
  ContestStatus,
  ContestFormat,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';

interface ContestRow {
  id: string;
  leagueId: string;
  sportEventId?: string | null;
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  scoringEngine: ScoringEngine;
  sport?: Contest['sport'] | null;
  isExclusive: boolean;
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
  status: ContestEntry['status'];
  tiebreakerValue?: number | null;
  totalScore: number;
  standingsPosition?: number | null;
  isEliminated: boolean;
  picksCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContestEntryParticipantRow {
  pickId: string;
  sportEventParticipantId: string;
  participantId: string;
  participantName: string;
  participantStatus?: string | null;
  position?: string | null;
  teamAffiliation?: string | null;
  contestPoints: number;
  pickedAt: Date;
  latestPerformance: Record<string, unknown>;
}

export function toContestSummaryDto(
  contest: ContestRow,
  opts?: { entryCount?: number },
): ContestSummaryDto {
  return {
    id: contest.id,
    name: contest.name,
    status: contest.status,
    contestFormat: contest.contestFormat,
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
    contestConfiguration: toContestConfigurationDetailDto(contestConfiguration),
  };
}

function toContestConfigurationDetailDto(
  contestConfiguration?: ContestConfiguration | null,
): ContestConfigurationDetailDto | null {
  if (!contestConfiguration) {
    return null;
  }

  const isManagedConfiguration = Boolean(contestConfiguration.configJson);
  const maxEntriesPerSquad =
    isManagedConfiguration
      ? (contestConfiguration.maxEntriesPerSquad ?? null)
      : (contestConfiguration.maxEntriesPerSquad ?? 1);

  if (isManagedConfiguration && contestConfiguration.configJson) {
    return {
      ...contestConfiguration.configJson,
      mode: contestConfiguration.configMode ?? contestConfiguration.configJson.mode,
      locksAt: contestConfiguration.locksAt?.toISOString() ?? null,
      maxEntriesPerSquad,
    };
  }

  return {
    rounds: contestConfiguration.rounds,
    timePerPickSeconds: contestConfiguration.timePerPickSeconds,
    autoPickPolicy: contestConfiguration.autoPickPolicy,
    tierConfig: contestConfiguration.tierConfig?.map((tier, index) => ({
      tierId: tier.tierId ?? tier.tierKey,
      tierName: tier.tierName ?? tier.label,
      tierNumber: tier.tierNumber ?? index + 1,
      picksFromTier: tier.picksFromTier ?? tier.pickCount,
      participantIds: tier.participantIds ?? [],
    })),
    budget: contestConfiguration.budget,
    pickCount: contestConfiguration.pickCount,
    isExclusive: contestConfiguration.isExclusive,
    picksPerPeriod: contestConfiguration.picksPerPeriod,
    rosterSize: contestConfiguration.rosterSize,
    roundValues: contestConfiguration.roundValues,
    startRound: contestConfiguration.startRound,
    locksAt: contestConfiguration.locksAt?.toISOString() ?? null,
    maxEntriesPerSquad,
  };
}

export function toContestListResponse(
  contests: ContestRow[],
  entryCounts?: Map<string, number>,
): ContestListResponse {
  return {
    contests: contests.map((c) =>
      toContestSummaryDto(c, {
        entryCount: entryCounts?.get(c.id),
      }),
    ),
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
    tiebreakerValue: entry.tiebreakerValue ?? null,
    totalScore: entry.totalScore,
    standingsPosition: entry.standingsPosition ?? null,
    isEliminated: entry.isEliminated,
    picksCount: entry.picksCount,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export function toContestEntryResponse(contestId: string, entry: ContestEntryDto): ContestEntryResponse {
  return { contestId, entry };
}

export function toContestEntryParticipantDetailDto(
  participant: ContestEntryParticipantRow,
): ContestEntryParticipantDetailDto {
  return {
    pickId: participant.pickId,
    sportEventParticipantId: participant.sportEventParticipantId,
    participantId: participant.participantId,
    participantName: participant.participantName,
    participantStatus: participant.participantStatus ?? null,
    position: participant.position ?? null,
    teamAffiliation: participant.teamAffiliation ?? null,
    contestPoints: participant.contestPoints,
    pickedAt: participant.pickedAt.toISOString(),
    latestPerformance: participant.latestPerformance,
  };
}

export function toContestEntryDetailDto(
  entry: ContestEntryRow,
  squad: { name: string },
  participants: ContestEntryParticipantRow[] | null,
): ContestEntryDetailDto {
  const summary = toContestEntryDto(entry, squad);
  if (participants === null) {
    return summary;
  }
  return {
    ...summary,
    participants: participants.map(toContestEntryParticipantDetailDto),
  };
}

export function toContestEntryDetailResponse(
  contestId: string,
  entry: ContestEntryDetailDto,
  picksRevealed: boolean,
): ContestEntryDetailResponse {
  return { contestId, picksRevealed, entry };
}

export function toContestEntryListResponse(input: {
  contestId: string;
  entries: ContestEntryDetailDto[];
  isJoined: boolean;
  myEntryId: string | null;
  myEntryIds?: string[];
  picksRevealed: boolean;
}): ContestEntryListResponse {
  return {
    contestId: input.contestId,
    total: input.entries.length,
    isJoined: input.isJoined,
    myEntryId: input.myEntryId,
    myEntryIds: input.myEntryIds,
    picksRevealed: input.picksRevealed,
    entries: input.entries,
  };
}

export function toMyContestEntryResponse(
  contestId: string,
  entry: ContestEntryDto | null,
): MyContestEntryResponse {
  return { contestId, entry };
}

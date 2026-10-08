/**
 * Contest mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  ContestDto,
  ContestResponse,
  ContestConfigurationDetailDto,
  ContestListResponse,
  ContestEntryDto,
  ContestEntryParticipantDetailDto,
  ContestEntryListResponse,
  ContestEntryDetailResponse,
  ContestEntryResponse,
  ContestLeaderboardResponse,
  MyContestEntryResponse,
} from '@poolmaster/shared/dto';
import {
  Sport,
  type Contest,
  type ContestConfiguration,
  type ContestEntry,
  type ContestEntryStatus,
  type ContestStatus,
  type ContestFormat,
  type ParticipantScoringDefinitionId,
  type ScoringEngine,
  type SelectionType,
} from '@poolmaster/shared/domain';
import type { ContestCountingRule, ParticipantScore } from '../modules/contests/contest-leaderboard-calculator';
import type { SportEventParticipantView } from '../modules/events/sport-event-participant-service';
import { mapSportEventParticipantToDto } from './sport-event-participants.mapper';

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
  role?: string | null;
  teamAffiliation?: string | null;
  pickedAt: Date;
}

/** One pick, with whether it counts and the score it joins to. */
export interface ScoredContestEntryPickRow {
  pickId: string;
  sportEventParticipantId: string;
  pickedAt: Date;
  slot: number | null;
  isCounting: boolean;
  isDropped: boolean;
  participant: ParticipantScore;
}

/** One entry's standing. `score` is its total under the contest's scoring definition. */
export interface ContestEntryStandingRow {
  entryId: string;
  entryName: string;
  entryNumber: number;
  squadId: string;
  squadName: string;
  status: ContestEntryStatus;
  score: number | null;
  position: number | null;
  displayPosition: string | null;
  countingPickLimit: number;
  scoredPickCount: number;
  picks: ScoredContestEntryPickRow[];
}

export interface ContestLeaderboardModel {
  contestId: string;
  sportEventId: string;
  sport: Sport;
  scoringDefinitionId: ParticipantScoringDefinitionId;
  countingRule: ContestCountingRule;
  /** The event's field rows, published as the event's own canonical DTO. */
  participants: SportEventParticipantView[];
  entries: ContestEntryStandingRow[];
  asOf: Date | null;
}

export function toContestDto(
  contest: ContestRow,
  opts?: { entryCount?: number },
): ContestDto {
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
    isExclusive: contest.isExclusive,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
  };
}

export function toContestResponse(
  contest: ContestRow,
  contestConfiguration?: ContestConfiguration | null,
): ContestResponse {
  return {
    contest: toContestDto(contest),
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
    // Only the typed settings: rows saved before #416 also hold a lock time and an entry cap.
    return {
      picksPerTier: contestConfiguration.configJson.picksPerTier,
      countedScores: contestConfiguration.configJson.countedScores,
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
    maxEntriesPerSquad,
  };
}

export function toContestListResponse(
  contests: ContestRow[],
  entryCounts?: Map<string, number>,
): ContestListResponse {
  return {
    contests: contests.map((c) =>
      toContestDto(c, {
        entryCount: entryCounts?.get(c.id),
      }),
    ),
  };
}

/** An entry, with its picked participants when the viewer may see them (`null` hides them). */
export function toContestEntryDto(
  entry: ContestEntryRow,
  squad: { name: string },
  participants: ContestEntryParticipantRow[] | null = null,
): ContestEntryDto {
  return {
    id: entry.id,
    contestId: entry.contestId,
    squadId: entry.squadId,
    squadName: squad.name,
    entryNumber: entry.entryNumber,
    name: entry.name,
    status: entry.status,
    tiebreakerValue: entry.tiebreakerValue ?? null,
    isEliminated: entry.isEliminated,
    picksCount: entry.picksCount,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    ...(participants !== null && { participants: participants.map(toContestEntryParticipantDetailDto) }),
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
    role: participant.role ?? null,
    teamAffiliation: participant.teamAffiliation ?? null,
    pickedAt: participant.pickedAt.toISOString(),
  };
}

export function toContestEntryDetailResponse(
  contestId: string,
  entry: ContestEntryDto,
  picksRevealed: boolean,
): ContestEntryDetailResponse {
  return { contestId, picksRevealed, entry };
}

export function toContestEntryListResponse(input: {
  contestId: string;
  entries: ContestEntryDto[];
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

export function toContestLeaderboardResponse(
  leaderboard: ContestLeaderboardModel,
): ContestLeaderboardResponse {
  return {
    contestId: leaderboard.contestId,
    sportEventId: leaderboard.sportEventId,
    scoringDefinitionId: leaderboard.scoringDefinitionId,
    countingRule: leaderboard.countingRule,
    participants: leaderboard.participants.map(mapSportEventParticipantToDto),
    entries: leaderboard.entries.map((entry) => ({
      entryId: entry.entryId,
      entryName: entry.entryName,
      entryNumber: entry.entryNumber,
      squadId: entry.squadId,
      squadName: entry.squadName,
      status: entry.status,
      position: entry.position,
      displayPosition: entry.displayPosition,
      countingPickLimit: entry.countingPickLimit,
      scoredPickCount: entry.scoredPickCount,
      golf: leaderboard.sport === Sport.GOLF ? { totalScoreToPar: entry.score } : null,
      picks: entry.picks.map((pick) => ({
        pickId: pick.pickId,
        sportEventParticipantId: pick.sportEventParticipantId,
        pickedAt: pick.pickedAt.toISOString(),
        slot: pick.slot,
        isCounting: pick.isCounting,
        isDropped: pick.isDropped,
        golf: leaderboard.sport === Sport.GOLF
          ? { scoreToPar: pick.participant.score, unplayedRoundNumbers: pick.participant.unplayedRoundNumbers }
          : null,
      })),
    })),
    asOf: leaderboard.asOf?.toISOString() ?? null,
  };
}

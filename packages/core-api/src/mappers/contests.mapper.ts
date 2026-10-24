/**
 * Contest mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  ContestDto,
  ContestSportEventDto,
  ContestResponse,
  ContestListResponse,
  ContestEntryDto,
  ContestEntryParticipantDetailDto,
  ContestEntryListResponse,
  ContestEntryDetailResponse,
  ContestEntryResponse,
  ContestLeaderboardResponse,
} from '@poolmaster/shared/dto';
import {
  ScoringFamily,
  type Sport,
  type Contest,
  type ContestEntry,
  type ContestStatus,
  type ContestFormat,
  type ParticipantScoringDefinitionId,
  type SelectionType,
  type SportEventStatus,
} from '@poolmaster/shared/domain';
import {
  participantScoreDetailFor,
  type ContestCountingRule,
  type ParticipantScore,
} from '../modules/contests/contest-leaderboard-calculator';
import type { SportEventParticipantView } from '../modules/events/sport-event-participant-service';
import { mapSportEventParticipantToDto } from './sport-event-participants.mapper';

interface ContestRow {
  id: string;
  leagueId: string;
  sportEventIds: string[];
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  sport?: Contest['sport'] | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  drawnAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContestEntryRow {
  id: string;
  contestId: string;
  squadId: string;
  entryNumber: number;
  name: string;
  /** The entry's status per event, already in the contest's event order. */
  events: ContestEntry['events'];
  tiebreakerValue?: number | null;
  picksCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContestEntryParticipantRow {
  pickId: string;
  sportEventParticipantId: string;
  sportEventId: string;
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
  score: number | null;
  position: number | null;
  displayPosition: string | null;
  countingPickLimit: number;
  scoredPickCount: number;
  picks: ScoredContestEntryPickRow[];
}

/** An entry's result in one event of its contest (#713). */
export interface ContestEntryEventResultRow {
  sportEventId: string;
  score: number | null;
  position: number | null;
  displayPosition: string | null;
}

/**
 * A leaderboard entry: its contest total and rank (`score`, `position`), its result in each
 * event, and its picks in the shown event with that event's counting.
 */
export interface ContestLeaderboardEntryRow extends ContestEntryStandingRow {
  events: ContestEntryEventResultRow[];
}

export interface ContestLeaderboardModel {
  contestId: string;
  /** The event whose field and picks are shown. */
  sportEventId: string;
  sport: Sport;
  /** The shown event's scoring family, by its sport league's definition (#934): which pick detail its picks carry. */
  scoringFamily: ScoringFamily;
  scoringDefinitionId: ParticipantScoringDefinitionId;
  countingRule: ContestCountingRule;
  /** The shown event's field rows, published as the event's own canonical DTO. */
  participants: SportEventParticipantView[];
  entries: ContestLeaderboardEntryRow[];
  asOf: Date | null;
}

/** What a contest read shows of each of its events. */
export interface ContestSportEventRow {
  id: string;
  name: string;
  startDate: Date;
  status: SportEventStatus;
}

function toContestSportEventDto(event: ContestSportEventRow, sequence: number): ContestSportEventDto {
  return {
    sportEventId: event.id,
    sequence,
    name: event.name,
    startDate: event.startDate.toISOString(),
    status: event.status,
  };
}

/** A contest with its events, in its sequence order, read from `eventsById` (#713). */
export function toContestDto(
  contest: ContestRow,
  eventsById: ReadonlyMap<string, ContestSportEventRow>,
  opts?: { entryCount?: number },
): ContestDto {
  return {
    id: contest.id,
    name: contest.name,
    status: contest.status,
    contestFormat: contest.contestFormat,
    selectionType: contest.selectionType,
    leagueId: contest.leagueId,
    sportEvents: contest.sportEventIds.flatMap((sportEventId, index) => {
      const event = eventsById.get(sportEventId);
      return event ? [toContestSportEventDto(event, index + 1)] : [];
    }),
    sport: contest.sport ?? null,
    entryCount: opts?.entryCount,
    startsAt: contest.startsAt?.toISOString() ?? null,
    endsAt: contest.endsAt?.toISOString() ?? null,
    drawnAt: contest.drawnAt?.toISOString() ?? null,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
  };
}

export function toContestResponse(
  contest: ContestRow,
  eventsById: ReadonlyMap<string, ContestSportEventRow>,
): ContestResponse {
  return { contest: toContestDto(contest, eventsById) };
}

/** Each listed contest with its entry count and its events' names and starts (#577). */
export function toContestListResponse(
  contests: ContestRow[],
  entryCounts: ReadonlyMap<string, number>,
  eventsById: ReadonlyMap<string, ContestSportEventRow>,
): ContestListResponse {
  return {
    contests: contests.map((c) => toContestDto(c, eventsById, { entryCount: entryCounts.get(c.id) })),
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
    events: entry.events.map((event) => ({
      sportEventId: event.sportEventId,
      status: event.status,
      submittedAt: event.submittedAt?.toISOString() ?? null,
    })),
    tiebreakerValue: entry.tiebreakerValue ?? null,
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
    sportEventId: participant.sportEventId,
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

type LeaderboardEntryDto = ContestLeaderboardResponse['entries'][number];
type LeaderboardPickDto = LeaderboardEntryDto['picks'][number];

/** How a scoring family's detail block appears on a leaderboard pick (#606). */
type LeaderboardFamilyPickDetailMapper = (pick: ScoredContestEntryPickRow) => Pick<LeaderboardPickDto, 'golf' | 'race' | 'knockout'>;

const LEADERBOARD_PICK_DETAIL_BY_SCORING_FAMILY: Readonly<Record<ScoringFamily, LeaderboardFamilyPickDetailMapper>> = {
  [ScoringFamily.STROKE_PLAY]: (pick) => ({
    golf: {
      scoreToPar: pick.participant.score,
      unplayedRoundNumbers: participantScoreDetailFor(ScoringFamily.STROKE_PLAY, pick.participant.detail)
        .unplayedRoundNumbers,
    },
    race: null,
    knockout: null,
  }),
  [ScoringFamily.FINISH_POSITION]: (pick) => ({ golf: null, race: { points: pick.participant.score }, knockout: null }),
  [ScoringFamily.HEAD_TO_HEAD]: (pick) => {
    const { wins, upsetBonusPoints, isAlive } = participantScoreDetailFor(
      ScoringFamily.HEAD_TO_HEAD,
      pick.participant.detail,
    );
    return {
      golf: null,
      race: null,
      knockout: { points: pick.participant.score, wins, upsetBonusPoints, isAlive },
    };
  },
  // A stat pool's per-game block arrives with its leaderboard columns (#936); the entry's total
  // is already on the row.
  [ScoringFamily.COMPOSITE]: () => ({ golf: null, race: null, knockout: null }),
};

export function toContestLeaderboardResponse(
  leaderboard: ContestLeaderboardModel,
): ContestLeaderboardResponse {
  const pickDetail = LEADERBOARD_PICK_DETAIL_BY_SCORING_FAMILY[leaderboard.scoringFamily];
  return {
    contestId: leaderboard.contestId,
    sportEventId: leaderboard.sportEventId,
    sport: leaderboard.sport,
    scoringDefinitionId: leaderboard.scoringDefinitionId,
    countingRule: leaderboard.countingRule,
    participants: leaderboard.participants.map(mapSportEventParticipantToDto),
    entries: leaderboard.entries.map((entry) => ({
      entryId: entry.entryId,
      entryName: entry.entryName,
      entryNumber: entry.entryNumber,
      squadId: entry.squadId,
      squadName: entry.squadName,
      position: entry.position,
      displayPosition: entry.displayPosition,
      countingPickLimit: entry.countingPickLimit,
      scoredPickCount: entry.scoredPickCount,
      totalScore: entry.score,
      events: entry.events.map((event) => ({
        sportEventId: event.sportEventId,
        totalScore: event.score,
        position: event.position,
        displayPosition: event.displayPosition,
      })),
      picks: entry.picks.map((pick) => ({
        pickId: pick.pickId,
        sportEventParticipantId: pick.sportEventParticipantId,
        pickedAt: pick.pickedAt.toISOString(),
        slot: pick.slot,
        isCounting: pick.isCounting,
        isDropped: pick.isDropped,
        ...pickDetail(pick),
      })),
    })),
    asOf: leaderboard.asOf?.toISOString() ?? null,
  };
}

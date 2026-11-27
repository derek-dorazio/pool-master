/**
 * Contest mappers — convert internal domain/Prisma objects to DTOs.
 */
import type {
  ContestDto,
  ContestProgressDto,
  ContestCoveredSlotDto,
  ContestSportEventDto,
  ContestResponse,
  ContestFinishedYearsResponse,
  ContestListResponse,
  ContestEntryDto,
  ContestEntryPlaceDto,
  ContestEntryParticipantDetailDto,
  ContestEntryListResponse,
  ContestEntryDetailResponse,
  ContestEntryResponse,
  ContestLeaderboardResponse,
  MyContestEntriesResponse,
} from '@poolmaster/shared/dto';
import type { ContestEntryTotals } from '@poolmaster/shared/db';
import {
  ScoringFamily,
  type ParticipantType,
  type Sport,
  type Contest,
  type ContestCoveredSlot,
  type ContestEntry,
  type ContestStatus,
  type ContestFormat,
  type ParticipantScoringDefinitionId,
  type SelectionType,
  type SportEventStatus,
} from '@poolmaster/shared/domain';
import {
  participantScoreDetailFor,
  type ContestLeaderboardCountingRule,
  type ParticipantScore,
} from '../modules/contests/contest-leaderboard-calculator';
import type { SportEventParticipantView } from '../modules/events/sport-event-participant-service';
import { mapSportEventParticipantToDto } from './sport-event-participants.mapper';

interface ContestRow {
  id: string;
  leagueId: string;
  sportEventIds: string[];
  coveredSlots: ContestCoveredSlot[];
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  sport?: Contest['sport'] | null;
  sportUrlSegment?: string | null;
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
  pickedAt: Date;
}

/** One pick, with whether it counts and the score it joins to. */
export interface ScoredContestEntryPickRow {
  pickId: string;
  sportEventParticipantId: string;
  pickedAt: Date;
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
  /**
   * The shown event's sport league's participant type and scoring family (#2001). The family
   * names the pick detail its picks carry.
   */
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
  scoringDefinitionId: ParticipantScoringDefinitionId;
  countingRule: ContestLeaderboardCountingRule;
  /** Whether the contest scores an upset bonus: a knockout contest with its bonus on (#1748). */
  upsetBonus: boolean;
  /** What an unplayed golf round adds to par, the contest's setting; null when not golf's to-par total. */
  unplayedRoundToPar: number | null;
  /** The round the shown event's field is on; null before one is scored, or with no rounds. */
  currentRound: { roundNumber: number; isComplete: boolean } | null;
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
  endDate?: Date;
  status: SportEventStatus;
  /** Its sport league's participant type and scoring family (#2001). */
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
}

function toContestSportEventDto(event: ContestSportEventRow, tierSetSeasonSlots?: ReadonlyMap<string, string>): ContestSportEventDto {
  return {
    ...(tierSetSeasonSlots === undefined ? {} : { tierSetSeasonSlotId: tierSetSeasonSlots.get(event.id) ?? null }),
    sportEventId: event.id,
    name: event.name,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    status: event.status,
    participantType: event.participantType,
    scoringFamily: event.scoringFamily,
  };
}

function toContestCoveredSlotDto(slot: ContestCoveredSlot): ContestCoveredSlotDto {
  return {
    seasonSlotId: slot.seasonSlotId,
    slotDefinitionId: slot.slotDefinitionId,
    key: slot.key,
    name: slot.name,
    slotKind: slot.slotKind,
    weekNumber: slot.weekNumber,
    status: slot.status,
    startsAt: slot.startsAt?.toISOString() ?? null,
    endsAt: slot.endsAt?.toISOString() ?? null,
    sportEventId: slot.sportEventId,
    competitionCode: slot.competitionCode,
    competitionName: slot.competitionName,
  };
}

/** A contest with its events in the order their covered slots are played, read from `eventsById` (#713). */
export function toContestDto(
  contest: ContestRow,
  eventsById: ReadonlyMap<string, ContestSportEventRow>,
  opts: { entriesPerContest: number | null; currentSlotId: string | null; entryCount?: number; allEntryCount?: number; progress?: ContestProgressDto | null; detail?: ContestEntrySummaryRow; tierSetSeasonSlots?: ReadonlyMap<string, string> },
): ContestDto {
  return {
    id: contest.id,
    name: contest.name,
    status: contest.status,
    contestFormat: contest.contestFormat,
    selectionType: contest.selectionType,
    leagueId: contest.leagueId,
    sportEvents: contest.sportEventIds.flatMap((sportEventId) => {
      const event = eventsById.get(sportEventId);
      return event ? [toContestSportEventDto(event, opts.tierSetSeasonSlots)] : [];
    }),
    coveredSlots: contest.coveredSlots.map(toContestCoveredSlotDto),
    currentSlotId: opts.currentSlotId,
    sport: contest.sport ?? null,
    sportUrlSegment: contest.sportUrlSegment ?? null,
    entryCount: opts.detail?.totals.submittedEntryCount ?? opts.entryCount,
    enteredSquadCount: opts.detail?.totals.enteredSquadCount,
    allEntryCount: opts.detail?.totals.allEntryCount ?? opts.allEntryCount,
    myEntryIds: opts.detail?.myEntryIds,
    ...(opts.progress === undefined ? {} : { progress: opts.progress }),
    entriesPerContest: opts.entriesPerContest,
    startsAt: contest.startsAt?.toISOString() ?? null,
    endsAt: contest.endsAt?.toISOString() ?? null,
    drawnAt: contest.drawnAt?.toISOString() ?? null,
    createdAt: contest.createdAt.toISOString(),
    updatedAt: contest.updatedAt.toISOString(),
  };
}

/**
 * What the single-contest read adds (#1197): the contest's entry totals and the viewer's entry
 * ids, and the Season slot whose set each event's picks come from (#2044), by event id.
 */
export interface ContestEntrySummaryRow {
  totals: ContestEntryTotals;
  myEntryIds: string[];
  tierSetSeasonSlots?: ReadonlyMap<string, string>;
}

/** One contest; the single-contest read passes its entry summary (#1197), the writes do not. */
export function toContestResponse(
  contest: ContestRow,
  eventsById: ReadonlyMap<string, ContestSportEventRow>,
  counts: { entriesPerContest: number | null; currentSlotId: string | null },
  detail?: ContestEntrySummaryRow,
): ContestResponse {
  return { contest: toContestDto(contest, eventsById, { ...counts, detail, tierSetSeasonSlots: detail?.tierSetSeasonSlots }) };
}

/**
 * Each listed contest with its submitted and total entry counts (#1781), its entry cap (#987), its
 * events' names and starts (#577), and a live contest's progress (#1782).
 */
export function toContestListResponse(
  contests: ContestRow[],
  counts: {
    allEntryCounts: ReadonlyMap<string, number>;
    entryCaps: ReadonlyMap<string, number | null>;
    entryCounts: ReadonlyMap<string, number>;
    progress: ReadonlyMap<string, ContestProgressDto>;
    currentSlotIds: ReadonlyMap<string, string>;
  },
  eventsById: ReadonlyMap<string, ContestSportEventRow>,
): ContestListResponse {
  return {
    contests: contests.map((c) => toContestDto(c, eventsById, {
      entryCount: counts.entryCounts.get(c.id),
      allEntryCount: counts.allEntryCounts.get(c.id),
      entriesPerContest: counts.entryCaps.get(c.id) ?? null,
      progress: counts.progress.get(c.id) ?? null,
      currentSlotId: counts.currentSlotIds.get(c.id) ?? null,
    })),
  };
}

/** The years a league has finished contests in, newest first. */
export function toContestFinishedYearsResponse(years: readonly number[]): ContestFinishedYearsResponse {
  return { years: [...years] };
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
  picksRevealed: boolean;
}): ContestEntryListResponse {
  return {
    contestId: input.contestId,
    total: input.entries.length,
    picksRevealed: input.picksRevealed,
    entries: input.entries,
  };
}

/** The viewer's own squad's entries across a league's current contests (#1197). */
export function toMyContestEntriesResponse(mine: { entries: ContestEntryDto[]; places: ContestEntryPlaceDto[] }): MyContestEntriesResponse {
  return { entries: mine.entries, places: mine.places };
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
};

/**
 * A stored leaderboard (#1435) as the API answers it: the board it holds, which was mapped by
 * `toContestLeaderboardResponse` when it was computed.
 */
export function toContestLeaderboardSnapshotResponse(
  snapshot: { board: ContestLeaderboardResponse },
): ContestLeaderboardResponse {
  return snapshot.board;
}

export function toContestLeaderboardResponse(
  leaderboard: ContestLeaderboardModel,
): ContestLeaderboardResponse {
  const pickDetail = LEADERBOARD_PICK_DETAIL_BY_SCORING_FAMILY[leaderboard.scoringFamily];
  return {
    contestId: leaderboard.contestId,
    sportEventId: leaderboard.sportEventId,
    sport: leaderboard.sport,
    participantType: leaderboard.participantType,
    scoringFamily: leaderboard.scoringFamily,
    scoringDefinitionId: leaderboard.scoringDefinitionId,
    countingRule: leaderboard.countingRule,
    upsetBonus: leaderboard.upsetBonus,
    unplayedRoundToPar: leaderboard.unplayedRoundToPar,
    currentRound: leaderboard.currentRound,
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
        slot: null,
        isCounting: pick.isCounting,
        isDropped: pick.isDropped,
        ...pickDetail(pick),
      })),
    })),
    asOf: leaderboard.asOf?.toISOString() ?? null,
  };
}

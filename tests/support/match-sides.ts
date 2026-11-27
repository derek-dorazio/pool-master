/**
 * Matches with sides and Games (#2046), built from the home-and-away shape tests have always
 * written: home is side 2 and away side 1, as the sync and the API name them. Test code only.
 *
 * `legacyMatch` builds a domain match from the old row's fields; `homeAwayOf` reads one back in
 * those fields, so an assertion on a service can name home and away; `withHomeAway` changes some
 * of those fields on a built match. The API answers on sides (#2184): `sideOfDto` reads a DTO.
 */
import {
  gameNumbered,
  HomeAway,
  MatchEnding,
  MatchSide,
  MatchSideOutcome,
  MatchStatus,
  matchScoreOf,
  matchSideOfSideNumber,
  matchSpread,
  PeriodKind,
  runningPeriodScores,
  shootoutScoreOf,
  sideParticipantId,
  SlotKind,
  sideNumberOfMatchSide,
  winningSide,
  type SportEventRoundMatch,
  type SportEventRoundMatchGame,
  type SportEventRoundMatchGameSideResult,
  type SportEventRoundMatchSide,
  matchCompletedAt,
  matchIsNeutralSite,
} from '@poolmaster/shared/domain';
import type { SportEventRoundMatchDto, SportEventRoundMatchSideDto } from '@poolmaster/shared/dto/bracket.dto';
import type { MatchResultInput, PeriodScoreInput } from '../../packages/core-api/src/modules/scoring-families/head-to-head/match-result-service';
import type { BracketMatchEdit, BracketMatchInput } from '../../packages/core-api/src/modules/events/sport-event-bracket-service';
import { roundSlot } from './round-slots';

const T0 = new Date('2026-01-01T00:00:00.000Z');
export const HOME_SIDE = sideNumberOfMatchSide(MatchSide.HOME);
export const AWAY_SIDE = sideNumberOfMatchSide(MatchSide.AWAY);

/** A Game 1 period's running totals, home and away, as the API gives them. */
export interface RunningPeriod {
  periodNumber: number;
  homeScore: number;
  awayScore: number;
}

/** The old match row's home-and-away fields, each optional. */
export interface HomeAwayFields {
  homeSportEventParticipantId?: string | null;
  awaySportEventParticipantId?: string | null;
  winnerSide?: MatchSide | null;
  /** Game 1's score in a single game; in a series, the games each side has won. */
  homeScore?: number | null;
  awayScore?: number | null;
  homeShootoutScore?: number | null;
  awayShootoutScore?: number | null;
  homeSpread?: number | null;
  advancesToSide?: MatchSide | null;
  /** Game 1's REGULAR periods as running totals. */
  periodScores?: readonly RunningPeriod[];
  /** Ignored: the column is gone (#2046). */
  resultSource?: unknown;
  /** Each Game's neutral-site flag (#2047): the match keeps none. */
  isNeutralSite?: boolean;
  /** A COMPLETED single game's or series' completion time, on its Games (#2047). */
  completedAt?: Date | null;
}

/** A match's own fields with the old home-and-away ones; every field but the place has a default. */
export type LegacyMatchRow = Partial<Omit<SportEventRoundMatch, 'sides' | 'games' | 'advancesToSideNumber'>>
  & Pick<SportEventRoundMatch, 'id'> & HomeAwayFields & { games?: readonly SportEventRoundMatchGame[] };

/** The object without the named keys. */
function omitKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !(keys as readonly PropertyKey[]).includes(key))) as Omit<T, K>;
}

/** A match built from its old home-and-away row. A series' score becomes one Game per game won. */
export function legacyMatch(row: LegacyMatchRow): SportEventRoundMatch {
  const {
    homeSportEventParticipantId = null, awaySportEventParticipantId = null, winnerSide = null, homeScore = null, awayScore = null,
    homeShootoutScore = null, awayShootoutScore = null, homeSpread = null, advancesToSide = null, periodScores = [],
    isNeutralSite = false, completedAt = null, games, ...rest
  } = row;
  const match = omitKeys(rest, ['resultSource']);
  const base = {
    sportEventId: 'event',
    roundNumber: 1,
    slot: roundSlot(SlotKind.TOURNAMENT),
    matchNumber: 1,
    scheduledDate: null,
    status: MatchStatus.SCHEDULED,
    ending: MatchEnding.PLAYED,
    advancesToMatchId: null,
    regionLabel: null,
    createdAt: T0,
    updatedAt: T0,
    ...match,
  };
  const outcomeOf = (side: MatchSide): MatchSideOutcome => {
    if (winnerSide !== null) return winnerSide === side ? MatchSideOutcome.WON : MatchSideOutcome.LOST;
    return base.status === MatchStatus.COMPLETED ? MatchSideOutcome.TIED : MatchSideOutcome.PENDING;
  };
  const sides: SportEventRoundMatchSide[] = [
    { id: `${base.id}-s1`, sideNumber: AWAY_SIDE, sportEventParticipantId: awaySportEventParticipantId, spread: homeSpread === null ? null : 0 - homeSpread, outcome: outcomeOf(MatchSide.AWAY) },
    { id: `${base.id}-s2`, sideNumber: HOME_SIDE, sportEventParticipantId: homeSportEventParticipantId, spread: null, outcome: outcomeOf(MatchSide.HOME) },
  ];
  return {
    ...base,
    advancesToSideNumber: advancesToSide === null ? null : sideNumberOfMatchSide(advancesToSide),
    sides,
    games: games ?? gamesOf({ ...base, isNeutralSite, completedAt }, sides, { homeScore, awayScore, homeShootoutScore, awayShootoutScore, periodScores }),
  };
}

type MatchBase = Pick<SportEventRoundMatch, 'id' | 'sportEventId' | 'roundNumber' | 'slot' | 'scheduledDate' | 'status'> & { isNeutralSite: boolean; completedAt: Date | null };

function gamesOf(
  match: MatchBase,
  sides: readonly SportEventRoundMatchSide[],
  scores: Pick<HomeAwayFields, 'homeScore' | 'awayScore' | 'homeShootoutScore' | 'awayShootoutScore'> & { periodScores: readonly RunningPeriod[] },
): SportEventRoundMatchGame[] {
  const homeAway = (sideNumber: number): HomeAway => {
    if (match.isNeutralSite) return HomeAway.NONE;
    return sideNumber === HOME_SIDE ? HomeAway.HOME : HomeAway.AWAY;
  };
  const game = (gameNumber: number, status: MatchStatus, completedAt: Date | null, scoreOf: (sideNumber: number) => number | null, periods: (sideNumber: number) => SportEventRoundMatchGameSideResult['periodScores']): SportEventRoundMatchGame => ({
    id: `${match.id}-g${String(gameNumber)}`,
    sportEventId: match.sportEventId,
    sportEventRoundMatchId: match.id,
    sportEventSlotId: `event-slot-${String(match.roundNumber)}`,
    gameNumber,
    scheduledDate: gameNumber === 1 ? match.scheduledDate : null,
    isNeutralSite: match.isNeutralSite,
    venue: null,
    location: null,
    status,
    completedAt,
    movedToGameId: null,
    lastProviderNotificationAt: null,
    createdAt: T0,
    updatedAt: T0,
    sideResults: sides.map((side) => ({ sportEventRoundMatchSideId: side.id, sideNumber: side.sideNumber, score: scoreOf(side.sideNumber), homeAway: homeAway(side.sideNumber), position: null, startPosition: null, status: null, riderName: null, periodScores: periods(side.sideNumber) })),
  });
  const homeScore = scores.homeScore ?? null;
  const awayScore = scores.awayScore ?? null;
  if (match.slot.seriesGames > 1) {
    // A series' score is games won: home wins its games first, then away its own. One with none won has its Game 1 to play.
    const winners = [...Array<number>(homeScore ?? 0).fill(HOME_SIDE), ...Array<number>(awayScore ?? 0).fill(AWAY_SIDE)];
    if (winners.length === 0) return [game(1, MatchStatus.SCHEDULED, null, () => null, () => [])];
    return winners.map((winner, index) => game(index + 1, MatchStatus.COMPLETED, match.completedAt, (sideNumber) => (sideNumber === winner ? 100 : 90), () => []));
  }
  const scoreOf = (sideNumber: number) => (sideNumber === HOME_SIDE ? homeScore : awayScore);
  const shootoutOf = (sideNumber: number) => (sideNumber === HOME_SIDE ? scores.homeShootoutScore : scores.awayShootoutScore) ?? null;
  const periodsOf = (sideNumber: number) => {
    const totals = [...scores.periodScores].sort((left, right) => left.periodNumber - right.periodNumber);
    const regular = totals.map((period, index) => {
      const pick = (each: RunningPeriod) => (sideNumber === HOME_SIDE ? each.homeScore : each.awayScore);
      return { kind: PeriodKind.REGULAR, periodNumber: period.periodNumber, score: pick(period) - (index === 0 ? 0 : pick(totals[index - 1])) };
    });
    const shootout = shootoutOf(sideNumber);
    return shootout === null ? regular : [...regular, { kind: PeriodKind.SHOOTOUT, periodNumber: 1, score: shootout }];
  };
  const single = match.slot.seriesGames === 1;
  return [game(1, single ? match.status : MatchStatus.SCHEDULED, single ? match.completedAt : null, scoreOf, periodsOf)];
}

/** A built match read back in the old home-and-away fields, for assertions on a service. */
export interface HomeAwayView extends Required<Omit<HomeAwayFields, 'resultSource'>> {
  status: MatchStatus;
}

/** A domain match with its home-and-away fields beside it: home is side 2 and away side 1, as the sync places them. */
export function homeAwayOf(match: SportEventRoundMatch): SportEventRoundMatch & HomeAwayView {
  return { ...match, ...homeAwayFieldsOf(match) };
}

function homeAwayFieldsOf(match: SportEventRoundMatch): HomeAwayView {
  const gameOne = gameNumbered(match, 1);
  const spread = matchSpread(match);
  const winner = winningSide(match);
  return {
    status: match.status,
    isNeutralSite: matchIsNeutralSite(match),
    completedAt: matchCompletedAt(match),
    homeSportEventParticipantId: sideParticipantId(match, HOME_SIDE),
    awaySportEventParticipantId: sideParticipantId(match, AWAY_SIDE),
    winnerSide: winner === null ? null : matchSideOfSideNumber(winner.sideNumber),
    homeScore: matchScoreOf(match, HOME_SIDE),
    awayScore: matchScoreOf(match, AWAY_SIDE),
    homeShootoutScore: gameOne === null ? null : shootoutScoreOf(gameOne, HOME_SIDE),
    awayShootoutScore: gameOne === null ? null : shootoutScoreOf(gameOne, AWAY_SIDE),
    homeSpread: spread === null ? null : 0 - spread,
    advancesToSide: match.advancesToSideNumber === null ? null : matchSideOfSideNumber(match.advancesToSideNumber),
    periodScores: gameOne === null ? [] : runningPeriodScores(gameOne)
      .filter((period) => period.kind === PeriodKind.REGULAR)
      .map(({ periodNumber, totals }) => ({ periodNumber, homeScore: totals.get(HOME_SIDE) ?? 0, awayScore: totals.get(AWAY_SIDE) ?? 0 })),
  };
}

/** One side of a match DTO by its number. */
export function sideOfDto(match: Pick<SportEventRoundMatchDto, 'id' | 'sides'>, sideNumber: number): SportEventRoundMatchSideDto {
  const side = match.sides.find((each) => each.sideNumber === sideNumber);
  if (side === undefined) throw new Error(`Match ${match.id} has no side ${String(sideNumber)}`);
  return side;
}

/** The team on a match DTO's side, or null while it is undecided. */
export function dtoTeamOn(match: Pick<SportEventRoundMatchDto, 'id' | 'sides'>, sideNumber: number): string | null {
  return sideOfDto(match, sideNumber).sportEventParticipantId;
}

/** The match with some of its home-and-away fields changed; its Games are rebuilt only when a score field or the status is named. */
export function withHomeAway(match: SportEventRoundMatch, fields: HomeAwayFields & Partial<Omit<SportEventRoundMatch, 'sides' | 'games'>>): SportEventRoundMatch {
  const view = homeAwayFieldsOf(match);
  // A single game's Game 1 takes the match's status, as a result writes it.
  const rebuildsGames = ['homeScore', 'awayScore', 'homeShootoutScore', 'awayShootoutScore', 'periodScores', 'status', 'isNeutralSite', 'completedAt'].some((key) => key in fields);
  const { games } = match;
  const own = omitKeys(match, ['sides', 'games', 'advancesToSideNumber']);
  const rebuilt = legacyMatch({
    ...own,
    homeSportEventParticipantId: view.homeSportEventParticipantId,
    awaySportEventParticipantId: view.awaySportEventParticipantId,
    winnerSide: view.winnerSide,
    homeSpread: view.homeSpread,
    advancesToSide: view.advancesToSide,
    homeScore: view.homeScore,
    awayScore: view.awayScore,
    homeShootoutScore: view.homeShootoutScore,
    awayShootoutScore: view.awayShootoutScore,
    periodScores: view.periodScores,
    isNeutralSite: matchIsNeutralSite(match),
    completedAt: matchCompletedAt(match),
    ...(rebuildsGames ? {} : { games }),
    ...fields,
  });
  // A side keeps its id and its outcome unless the result changes.
  return 'winnerSide' in fields || 'status' in fields ? rebuilt : { ...rebuilt, sides: rebuilt.sides.map((side, index) => ({ ...side, outcome: match.sides[index].outcome })) };
}

/** A result request in the old home-and-away shape. */
export interface HomeAwayResultRequest {
  winnerSide: MatchSide | null;
  homeScore: number | null;
  awayScore: number | null;
  homeShootoutScore?: number | null;
  awayShootoutScore?: number | null;
  ending?: MatchEnding;
}

/** A result request in the old home-and-away shape, as the result service takes it. */
export function homeAwayResult({ winnerSide, homeScore, awayScore, homeShootoutScore = null, awayShootoutScore = null, ending }: HomeAwayResultRequest): MatchResultInput {
  return {
    winnerSideNumber: winnerSide === null ? null : sideNumberOfMatchSide(winnerSide),
    sides: [
      { sideNumber: AWAY_SIDE, score: awayScore, shootoutScore: awayShootoutScore },
      { sideNumber: HOME_SIDE, score: homeScore, shootoutScore: homeShootoutScore },
    ],
    ...(ending !== undefined && { ending }),
  };
}

/** A period's running totals in the old home-and-away shape, as the result service takes them. */
export function homeAwayPeriod({ homeScore, awayScore }: { homeScore: number; awayScore: number }): PeriodScoreInput {
  return [{ sideNumber: AWAY_SIDE, score: awayScore }, { sideNumber: HOME_SIDE, score: homeScore }];
}

/** Puts a team on a stored match's home or away side, as a test arranging the store does. */
export function placeTeam(match: SportEventRoundMatch, side: MatchSide, sportEventParticipantId: string | null): void {
  const sideNumber = sideNumberOfMatchSide(side);
  match.sides = match.sides.map((each) => (each.sideNumber === sideNumber ? { ...each, sportEventParticipantId } : each));
}

/** A bracket load's match in the home-and-away shape, as the bracket service takes it on sides. */
export interface HomeAwayBracketInput {
  roundNumber: number;
  matchNumber: number;
  homeSportEventParticipantId: string | null;
  awaySportEventParticipantId: string | null;
  isNeutralSite: boolean;
  scheduledDate: Date | null;
  advancesTo: { roundNumber: number; matchNumber: number; side: MatchSide } | null;
  regionLabel?: string | null;
}

/** A bracket service input on sides: away on side 1, home on side 2, each playing Game 1 where the site says. */
export function bracketInput({ homeSportEventParticipantId, awaySportEventParticipantId, advancesTo, ...match }: HomeAwayBracketInput): BracketMatchInput {
  return {
    ...match,
    sides: [
      { sideNumber: AWAY_SIDE, sportEventParticipantId: awaySportEventParticipantId, homeAway: match.isNeutralSite ? HomeAway.NONE : HomeAway.AWAY },
      { sideNumber: HOME_SIDE, sportEventParticipantId: homeSportEventParticipantId, homeAway: match.isNeutralSite ? HomeAway.NONE : HomeAway.HOME },
    ],
    advancesTo: advancesTo === null ? null : { roundNumber: advancesTo.roundNumber, matchNumber: advancesTo.matchNumber, sideNumber: sideNumberOfMatchSide(advancesTo.side) },
  };
}

/** A match edit in the home-and-away shape. */
export interface HomeAwayEditInput extends Omit<BracketMatchEdit, 'sides' | 'spread'> {
  homeSportEventParticipantId?: string | null;
  awaySportEventParticipantId?: string | null;
  /** The spread from the home side; side 1, the away side, holds its opposite. */
  homeSpread?: number | null;
}

/** A match edit as the bracket service takes it, by side number. */
export function editInput({ homeSportEventParticipantId, awaySportEventParticipantId, homeSpread, ...edit }: HomeAwayEditInput): BracketMatchEdit {
  const sides = [
    ...(awaySportEventParticipantId === undefined ? [] : [{ sideNumber: AWAY_SIDE, sportEventParticipantId: awaySportEventParticipantId }]),
    ...(homeSportEventParticipantId === undefined ? [] : [{ sideNumber: HOME_SIDE, sportEventParticipantId: homeSportEventParticipantId }]),
  ];
  return {
    ...edit,
    ...(sides.length > 0 && { sides }),
    ...(homeSpread !== undefined && { spread: homeSpread === null ? null : 0 - homeSpread }),
  };
}

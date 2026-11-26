/**
 * Match requests and reads on sides (#2184), from the home-and-away shape API tests are written
 * in: home is side 2 and away side 1, as the sync places a game's teams. Test code only. Each
 * request builder says where each side plays its Game 1 (`homeAway`); each reader takes the
 * published match DTO, so an assertion on the API names home and away while the wire carries
 * sides.
 */
import { HomeAway, MatchSide, MatchSideOutcome, PeriodKind, sideNumberOfMatchSide, type MatchEnding } from '@poolmaster/shared/domain';
import type {
  LoadSportEventBracketRequest,
  RecordSportEventMatchPeriodScoreRequest,
  RecordSportEventRoundMatchResultRequest,
  RoundMatchupDto,
  SportEventRoundMatchDto,
  UpdateSportEventRoundMatchRequest,
} from '@poolmaster/shared/dto/bracket.dto';

const HOME = sideNumberOfMatchSide(MatchSide.HOME);
const AWAY = sideNumberOfMatchSide(MatchSide.AWAY);

type LoadMatch = LoadSportEventBracketRequest['matches'][number];

/** One match of a bracket load in the home-and-away shape. */
export interface HomeAwayBracketMatch extends Omit<LoadMatch, 'sides' | 'advancesTo'> {
  homeSportEventParticipantId: string | null;
  awaySportEventParticipantId: string | null;
  advancesTo: { roundNumber: number; matchNumber: number; side: MatchSide } | null;
}

/** A bracket load's match on its sides: away on side 1, home on side 2, each playing Game 1 where the site says. */
export function bracketMatch({ homeSportEventParticipantId, awaySportEventParticipantId, advancesTo, ...match }: HomeAwayBracketMatch): LoadMatch {
  return {
    ...match,
    sides: [
      { sideNumber: AWAY, sportEventParticipantId: awaySportEventParticipantId, homeAway: match.isNeutralSite ? HomeAway.NONE : HomeAway.AWAY },
      { sideNumber: HOME, sportEventParticipantId: homeSportEventParticipantId, homeAway: match.isNeutralSite ? HomeAway.NONE : HomeAway.HOME },
    ],
    advancesTo: advancesTo === null ? null : { roundNumber: advancesTo.roundNumber, matchNumber: advancesTo.matchNumber, sideNumber: sideNumberOfMatchSide(advancesTo.side) },
  };
}

/** A match edit in the home-and-away shape: a side left out keeps its team. */
export interface HomeAwayMatchEdit extends Omit<UpdateSportEventRoundMatchRequest, 'sides' | 'spread'> {
  homeSportEventParticipantId?: string | null;
  awaySportEventParticipantId?: string | null;
  /** The spread from the home side; side 1, the away side, holds its opposite. */
  homeSpread?: number | null;
}

/** A match edit on sides. Naming one side keeps the other's team as `current` has it. */
export function matchEdit(
  { homeSportEventParticipantId, awaySportEventParticipantId, homeSpread, ...edit }: HomeAwayMatchEdit,
  current?: Pick<SportEventRoundMatchDto, 'id' | 'sides'>,
): UpdateSportEventRoundMatchRequest {
  const changesSides = homeSportEventParticipantId !== undefined || awaySportEventParticipantId !== undefined;
  const teamOf = (given: string | null | undefined, sideNumber: number) => (given === undefined ? (current === undefined ? null : dtoSideTeam(current, sideNumber)) : given);
  return {
    ...edit,
    ...(changesSides && {
      sides: [
        { sideNumber: AWAY, sportEventParticipantId: teamOf(awaySportEventParticipantId, AWAY) },
        { sideNumber: HOME, sportEventParticipantId: teamOf(homeSportEventParticipantId, HOME) },
      ],
    }),
    ...(homeSpread !== undefined && { spread: homeSpread === null ? null : 0 - homeSpread }),
  };
}

/** A result request in the home-and-away shape. */
export interface HomeAwayResult {
  winnerSide: MatchSide | null;
  homeScore: number | null;
  awayScore: number | null;
  homeShootoutScore?: number | null;
  awayShootoutScore?: number | null;
  ending?: MatchEnding;
}

/** A result request on sides. */
export function resultBody({ winnerSide, homeScore, awayScore, homeShootoutScore, awayShootoutScore, ending }: HomeAwayResult): RecordSportEventRoundMatchResultRequest {
  return {
    winnerSideNumber: winnerSide === null ? null : sideNumberOfMatchSide(winnerSide),
    sides: [
      { sideNumber: AWAY, score: awayScore, ...(awayShootoutScore !== undefined && { shootoutScore: awayShootoutScore }) },
      { sideNumber: HOME, score: homeScore, ...(homeShootoutScore !== undefined && { shootoutScore: homeShootoutScore }) },
    ],
    ...(ending !== undefined && { ending }),
  };
}

/** A period score request on sides. */
export function periodBody({ homeScore, awayScore }: { homeScore: number; awayScore: number }): RecordSportEventMatchPeriodScoreRequest {
  return { sides: [{ sideNumber: AWAY, score: awayScore }, { sideNumber: HOME, score: homeScore }] };
}

/** A reseeded round's matchup on sides: the host on side 2. */
export function matchup({ matchNumber, homeSportEventParticipantId, awaySportEventParticipantId }: { matchNumber: number; homeSportEventParticipantId: string; awaySportEventParticipantId: string }): RoundMatchupDto {
  return { matchNumber, sides: [{ sideNumber: AWAY, sportEventParticipantId: awaySportEventParticipantId }, { sideNumber: HOME, sportEventParticipantId: homeSportEventParticipantId }] };
}

/** A matchup's home and away teams. */
export function matchupTeams(matchup: RoundMatchupDto): { matchNumber: number; homeSportEventParticipantId: string | undefined; awaySportEventParticipantId: string | undefined } {
  const teamOn = (sideNumber: number) => matchup.sides.find((side) => side.sideNumber === sideNumber)?.sportEventParticipantId;
  return { matchNumber: matchup.matchNumber, homeSportEventParticipantId: teamOn(HOME), awaySportEventParticipantId: teamOn(AWAY) };
}

/** The team on one side of a match DTO. */
export function dtoSideTeam(match: Pick<SportEventRoundMatchDto, 'id' | 'sides'>, sideNumber: number): string | null {
  const side = match.sides.find((each) => each.sideNumber === sideNumber);
  if (side === undefined) throw new Error(`Match ${match.id} has no side ${String(sideNumber)}`);
  return side.sportEventParticipantId;
}

/** A match DTO read in the home-and-away fields. */
export interface HomeAwayRead {
  homeSportEventParticipantId: string | null;
  awaySportEventParticipantId: string | null;
  winnerSide: MatchSide | null;
  homeScore: number | null;
  awayScore: number | null;
  homeShootoutScore: number | null;
  awayShootoutScore: number | null;
  homeSpread: number | null;
  advancesToMatchId: string | null;
  advancesToSide: MatchSide | null;
  /** Game 1's regulation periods, running totals. */
  periodScores: { periodNumber: number; homeScore: number; awayScore: number }[];
}

/** A published match read in the home-and-away fields: home is side 2. */
export function readHomeAway(match: SportEventRoundMatchDto): HomeAwayRead {
  const side = (sideNumber: number) => match.sides.find((each) => each.sideNumber === sideNumber);
  const winner = match.sides.find((each) => each.outcome === MatchSideOutcome.WON);
  const gameOne = match.games.find((game) => game.gameNumber === 1);
  const result = (sideNumber: number) => gameOne?.sideResults.find((each) => each.sideNumber === sideNumber);
  const regular = (sideNumber: number) => result(sideNumber)?.periodScores.filter((period) => period.kind === PeriodKind.REGULAR) ?? [];
  const spread = side(AWAY)?.spread ?? null;
  return {
    homeSportEventParticipantId: side(HOME)?.sportEventParticipantId ?? null,
    awaySportEventParticipantId: side(AWAY)?.sportEventParticipantId ?? null,
    winnerSide: winner === undefined ? null : winner.sideNumber === HOME ? MatchSide.HOME : MatchSide.AWAY,
    homeScore: side(HOME)?.score ?? null,
    awayScore: side(AWAY)?.score ?? null,
    homeShootoutScore: result(HOME)?.shootoutScore ?? null,
    awayShootoutScore: result(AWAY)?.shootoutScore ?? null,
    homeSpread: spread === null ? null : 0 - spread,
    advancesToMatchId: match.advancesTo?.matchId ?? null,
    advancesToSide: match.advancesTo === null ? null : match.advancesTo.sideNumber === HOME ? MatchSide.HOME : MatchSide.AWAY,
    periodScores: regular(HOME).map((period) => ({
      periodNumber: period.periodNumber,
      homeScore: period.score,
      awayScore: regular(AWAY).find((other) => other.periodNumber === period.periodNumber)?.score ?? 0,
    })),
  };
}

/** A published match with its home-and-away read beside it, for assertions that name both. */
export function withHomeAwayRead(match: SportEventRoundMatchDto): SportEventRoundMatchDto & HomeAwayRead {
  return { ...match, ...readHomeAway(match) };
}

/** What a test data file's match carries, on sides (#2184). */
interface FileMatch {
  sides: readonly { sideNumber: number; player: string | null }[];
  result?: { winnerSideNumber: number | null; sides: readonly { sideNumber: number; score: number | null }[] };
}

/** The player key a test data file puts on a match's home (side 2) or away (side 1) side. */
export function fileTeamOn(match: FileMatch, side: MatchSide): string | null {
  return match.sides.find((each) => each.sideNumber === sideNumberOfMatchSide(side))?.player ?? null;
}

/** The side a test data file's result names the winner, or null for a draw or no result. */
export function fileWinnerSide(match: FileMatch): MatchSide | null {
  const winner = match.result?.winnerSideNumber ?? null;
  return winner === null ? null : winner === HOME ? MatchSide.HOME : MatchSide.AWAY;
}

/** A test data file's result score on a match's home or away side. */
export function fileScoreOn(match: FileMatch, side: MatchSide): number | null {
  return match.result?.sides.find((each) => each.sideNumber === sideNumberOfMatchSide(side))?.score ?? null;
}

/** A test data file's match, as the loader parses it. */
type SportDataMatchLike = {
  sides: readonly { sideNumber: number; player: string | null }[];
  advancesTo: { roundNumber: number; matchNumber: number; sideNumber: number } | null;
  result?: { winnerSideNumber: number | null; sides: readonly { sideNumber: number; score: number | null; shootoutScore?: number }[]; ending?: MatchEnding };
  periodScores?: readonly { periodNumber: number; sides: readonly { sideNumber: number; score: number }[] }[];
};

/** A test data file's match read in the home-and-away fields: home is side 2, away side 1. */
export function homeAwayFileMatch<M extends SportDataMatchLike>({ sides, advancesTo, result, periodScores, ...match }: M) {
  const on = <S extends { sideNumber: number }>(list: readonly S[], side: MatchSide) => list.find((each) => each.sideNumber === sideNumberOfMatchSide(side));
  const sideOf = (sideNumber: number) => (sideNumber === HOME ? MatchSide.HOME : MatchSide.AWAY);
  const home = result === undefined ? undefined : on(result.sides, MatchSide.HOME);
  const away = result === undefined ? undefined : on(result.sides, MatchSide.AWAY);
  return {
    ...match,
    home: on(sides, MatchSide.HOME)?.player ?? null,
    away: on(sides, MatchSide.AWAY)?.player ?? null,
    advancesTo: advancesTo === null ? null : { roundNumber: advancesTo.roundNumber, matchNumber: advancesTo.matchNumber, side: sideOf(advancesTo.sideNumber) },
    ...(result !== undefined && {
      result: {
        winner: result.winnerSideNumber === null ? null : sideOf(result.winnerSideNumber),
        homeScore: home?.score ?? null,
        awayScore: away?.score ?? null,
        ...(home?.shootoutScore !== undefined && { homeShootoutScore: home.shootoutScore }),
        ...(away?.shootoutScore !== undefined && { awayShootoutScore: away.shootoutScore }),
        ...(result.ending !== undefined && { ending: result.ending }),
      },
    }),
    ...(periodScores !== undefined && {
      periodScores: periodScores.map((period) => ({ periodNumber: period.periodNumber, homeScore: on(period.sides, MatchSide.HOME)?.score ?? 0, awayScore: on(period.sides, MatchSide.AWAY)?.score ?? 0 })),
    }),
  };
}

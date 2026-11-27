import { HomeAway, MatchSideOutcome, PeriodKind } from '@poolmaster/shared/domain';
import type { GamePicksResponse, GameSideResultDto, SportEventRoundMatchDto, SportEventRoundMatchGameDto, SportEventRoundMatchSideDto } from './api';

/**
 * Reading a match on its sides (#2184): each side by its number, the team on it, its result, and
 * where it played game 1. Every screen that shows a match reads it through these, so none of them
 * reaches into the sides list on its own. The facts are the API's; these only look them up.
 */

type MatchSides = Pick<SportEventRoundMatchDto, 'sides'>;
type GamePickSideDto = GamePicksResponse['games'][number]['sides'][number];

/** A match's side by its number. */
export function sideOn(match: MatchSides, sideNumber: number): SportEventRoundMatchSideDto | undefined {
  return match.sides.find((side) => side.sideNumber === sideNumber);
}

/** The field row on a side, or null while the side is undecided. */
export function teamOn(match: MatchSides, sideNumber: number): string | null {
  return sideOn(match, sideNumber)?.sportEventParticipantId ?? null;
}

/** The side a team plays in a match, or undefined when it plays neither. */
export function sideOfTeam(match: MatchSides, sportEventParticipantId: string): SportEventRoundMatchSideDto | undefined {
  return match.sides.find((side) => side.sportEventParticipantId === sportEventParticipantId);
}

/** The side playing against the given one. */
export function opposingSide(match: MatchSides, sideNumber: number): SportEventRoundMatchSideDto | undefined {
  return match.sides.find((side) => side.sideNumber !== sideNumber);
}

/** The side whose outcome is WON, or undefined while undecided and for a game left level. */
export function winningSide(match: MatchSides): SportEventRoundMatchSideDto | undefined {
  return match.sides.find((side) => side.outcome === MatchSideOutcome.WON);
}

/** Whether a decided game ended level: both sides TIED. */
export function isTied(match: MatchSides): boolean {
  return match.sides.length > 0 && match.sides.every((side) => side.outcome === MatchSideOutcome.TIED);
}

/** A match's game 1: a single game's only game, a series' opener. */
export function gameOne(match: Pick<SportEventRoundMatchDto, 'games'>): SportEventRoundMatchGameDto | undefined {
  return match.games.find((game) => game.gameNumber === 1);
}

/** One side's result in a game. */
export function sideResultIn(game: SportEventRoundMatchGameDto | undefined, sideNumber: number): GameSideResultDto | undefined {
  return game?.sideResults.find((result) => result.sideNumber === sideNumber);
}

/** Two sides in the order a schedule names them, and whether a "vs" joins them in place of "at". */
export interface BilledSides<Side> {
  first: Side | undefined;
  second: Side | undefined;
  isNeutralSite: boolean;
}

/**
 * Sides in the order a schedule names them, "away at home", from where each plays: the side
 * playing away first. Where neither side is home or away (HomeAway NONE, a neutral site), side 1
 * first, and the two are joined by "vs".
 */
function billInOrder<Side extends { sideNumber: number }>(sides: readonly Side[], homeAway: (side: Side) => HomeAway): BilledSides<Side> {
  const ordered = [...sides].sort((left, right) => left.sideNumber - right.sideNumber);
  const first = ordered.find((side) => homeAway(side) === HomeAway.AWAY) ?? ordered[0];
  return {
    first,
    second: ordered.find((side) => side !== first),
    isNeutralSite: ordered.every((side) => homeAway(side) === HomeAway.NONE),
  };
}

/** A match's two sides as a schedule bills them, from where each side plays game 1. */
export function billedSides(match: Pick<SportEventRoundMatchDto, 'sides' | 'games'>): BilledSides<SportEventRoundMatchSideDto> {
  const game = gameOne(match);
  return billInOrder(match.sides, (side) => sideResultIn(game, side.sideNumber)?.homeAway ?? HomeAway.NONE);
}

/** A pick screen game's two sides (#2016) as a schedule bills them, from where the API says each plays. */
export function billedPickSides<Side extends Pick<GamePickSideDto, 'sideNumber' | 'homeAway'>>(game: { sides: readonly Side[] }): BilledSides<Side> {
  return billInOrder(game.sides, (side) => side.homeAway);
}

/** A side's running score at the end of each period of regulation of a game, by period number. */
export function regulationPeriodScores(game: SportEventRoundMatchGameDto | undefined, sideNumber: number): ReadonlyMap<number, number> {
  return new Map((sideResultIn(game, sideNumber)?.periodScores ?? [])
    .filter((period) => period.kind === PeriodKind.REGULAR)
    .map((period) => [period.periodNumber, period.score]));
}

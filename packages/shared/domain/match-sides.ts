/**
 * Reading a match's sides and its Games' side results (#2046): the one place each fact about a
 * side is worked out, which every reader (pick'em, brackets, squares, the API's mappers) calls.
 */
import { HomeAway, MatchSide, MatchSideOutcome, MatchStatus, PeriodKind, PeriodKindOrder } from './enums';
import type { SportEventRoundMatch, SportEventRoundMatchGame, SportEventRoundMatchGameSideResult, SportEventRoundMatchSide } from './sport-catalog-types';

/** What reading a match's sides needs of it. */
export type MatchWithSides = Pick<SportEventRoundMatch, 'id' | 'sides'>;

/** A match's side by its number; a match has both its sides from the moment it is created. */
export function sideOf(match: MatchWithSides, sideNumber: number): SportEventRoundMatchSide {
  const side = match.sides.find((each) => each.sideNumber === sideNumber);
  if (side === undefined) throw new Error(`Match ${match.id} has no side ${String(sideNumber)}`);
  return side;
}

/** The side a match's other side plays against. */
export function opposingSideOf(match: MatchWithSides, sideNumber: number): SportEventRoundMatchSide {
  const side = match.sides.find((each) => each.sideNumber !== sideNumber);
  if (side === undefined) throw new Error(`Match ${match.id} has no side opposing side ${String(sideNumber)}`);
  return side;
}

/** The team on a side, or null while the side is undecided. */
export function sideParticipantId(match: MatchWithSides, sideNumber: number): string | null {
  return sideOf(match, sideNumber).sportEventParticipantId;
}

/** The side a team plays in a match, or null when it plays neither. */
export function sideOfParticipant(match: MatchWithSides, sportEventParticipantId: string): SportEventRoundMatchSide | null {
  return match.sides.find((side) => side.sportEventParticipantId === sportEventParticipantId) ?? null;
}

/** Both sides' teams, side 1 first, leaving out an undecided side. */
export function matchParticipantIds(match: MatchWithSides): string[] {
  return match.sides.flatMap((side) => (side.sportEventParticipantId === null ? [] : [side.sportEventParticipantId]));
}

/** The side that won the match, or null while it is undecided or when it ended level. */
export function winningSide(match: MatchWithSides): SportEventRoundMatchSide | null {
  return match.sides.find((side) => side.outcome === MatchSideOutcome.WON) ?? null;
}

/** The team that won the match, or null while none has. */
export function winnerParticipantId(match: MatchWithSides): string | null {
  return winningSide(match)?.sportEventParticipantId ?? null;
}

/** Whether a decided match ended level, both sides TIED. */
export function endedTied(match: MatchWithSides): boolean {
  return match.sides.length > 0 && match.sides.every((side) => side.outcome === MatchSideOutcome.TIED);
}

/** The spread on side 1 (the only side that holds one), or null. */
export function matchSpread(match: MatchWithSides): number | null {
  return match.sides.find((side) => side.spread !== null)?.spread ?? null;
}

/** A Game's result for one side, or null while none is written. */
function sideResultOf(game: Pick<SportEventRoundMatchGame, 'sideResults'>, sideNumber: number): SportEventRoundMatchGameSideResult | null {
  return game.sideResults.find((result) => result.sideNumber === sideNumber) ?? null;
}

/** One side's score in a Game, or null while it has none. */
export function gameScoreOf(game: Pick<SportEventRoundMatchGame, 'sideResults'>, sideNumber: number): number | null {
  return sideResultOf(game, sideNumber)?.score ?? null;
}

/** One side's kicks scored in a Game's shoot-out, or null when there was none. */
export function shootoutScoreOf(game: Pick<SportEventRoundMatchGame, 'sideResults'>, sideNumber: number): number | null {
  return sideResultOf(game, sideNumber)?.periodScores.find((period) => period.kind === PeriodKind.SHOOTOUT)?.score ?? null;
}

/** Where a side played a Game; NONE while no result says. */
export function homeAwayOf(game: Pick<SportEventRoundMatchGame, 'sideResults'>, sideNumber: number): HomeAway {
  return sideResultOf(game, sideNumber)?.homeAway ?? HomeAway.NONE;
}

/**
 * The side number that won a COMPLETED Game: the higher score, or on a level score the higher
 * shoot-out. Null for a Game not completed, and for one that ended level.
 */
export function gameWinnerSideNumber(game: Pick<SportEventRoundMatchGame, 'status' | 'sideResults'>): number | null {
  if (game.status !== MatchStatus.COMPLETED) return null;
  if (game.sideResults.length !== 2) return null;
  const [first, second] = [...game.sideResults].sort((a, b) => a.sideNumber - b.sideNumber);
  if (first.score === null || second.score === null) return null;
  if (first.score !== second.score) return first.score > second.score ? first.sideNumber : second.sideNumber;
  const firstKicks = shootoutScoreOf(game, first.sideNumber);
  const secondKicks = shootoutScoreOf(game, second.sideNumber);
  if (firstKicks === null || secondKicks === null || firstKicks === secondKicks) return null;
  return firstKicks > secondKicks ? first.sideNumber : second.sideNumber;
}

/** A match's Game by its number, or null while it has none. */
export function gameNumbered(match: Pick<SportEventRoundMatch, 'games'>, gameNumber: number): SportEventRoundMatchGame | null {
  return match.games.find((game) => game.gameNumber === gameNumber) ?? null;
}

/**
 * A side's score in the match: its Game 1 score in a single-game match, and in a best-of series
 * the games it has won. Null while a single game has no score, or a series no game decided.
 */
export function matchScoreOf(match: Pick<SportEventRoundMatch, 'slot' | 'games'>, sideNumber: number): number | null {
  if (match.slot.seriesGames === 1) {
    const gameOne = gameNumbered(match, 1);
    return gameOne === null ? null : gameScoreOf(gameOne, sideNumber);
  }
  const winners = match.games.map(gameWinnerSideNumber).filter((winner) => winner !== null);
  return winners.length === 0 ? null : winners.filter((winner) => winner === sideNumber).length;
}

/** Whether any of a match's Games has a period of play scored (#772): a game under way, though its status may not say so yet. A shoot-out is not a period of play. */
export function hasPeriodScores(match: Pick<SportEventRoundMatch, 'games'>): boolean {
  return match.games.some((game) => game.sideResults.some((result) => result.periodScores.some((period) => period.kind !== PeriodKind.SHOOTOUT)));
}

/** The running score of both sides at the end of one period of a Game, as a scoreboard shows it. */
interface RunningPeriodScore {
  kind: PeriodKind;
  periodNumber: number;
  /** Each side's points to the end of this period, by side number. */
  totals: ReadonlyMap<number, number>;
}

/**
 * Each period's running score in a Game (#2046), summed from the side results' own period points
 * in play order (regulation, then overtime; never the shoot-out). The one sum the API and squares
 * (#2019) read. Empty for a Game with no period scores.
 */
export function runningPeriodScores(game: Pick<SportEventRoundMatchGame, 'sideResults'>): RunningPeriodScore[] {
  const periods: { kind: PeriodKind; periodNumber: number }[] = [];
  for (const result of game.sideResults) {
    for (const { kind, periodNumber } of result.periodScores) {
      if (kind !== PeriodKind.SHOOTOUT && !periods.some((each) => each.kind === kind && each.periodNumber === periodNumber)) periods.push({ kind, periodNumber });
    }
  }
  const ordered = periods.sort((a, b) => PeriodKindOrder.orderIndex[a.kind] - PeriodKindOrder.orderIndex[b.kind] || a.periodNumber - b.periodNumber);
  const running = new Map<number, number>();
  return ordered.map(({ kind, periodNumber }) => {
    for (const result of game.sideResults) {
      const points = result.periodScores.find((period) => period.kind === kind && period.periodNumber === periodNumber)?.score ?? 0;
      running.set(result.sideNumber, (running.get(result.sideNumber) ?? 0) + points);
    }
    return { kind, periodNumber, totals: new Map(running) };
  });
}

/**
 * The side number the API's HOME and AWAY name (#2046), until the web app reads sides by number
 * (part b): the sync puts the home team on side 2 and the away team on side 1.
 */
export function sideNumberOfMatchSide(side: MatchSide): number {
  return side === MatchSide.HOME ? 2 : 1;
}

/** The API's HOME or AWAY for a side number: the reverse of `sideNumberOfMatchSide`. */
export function matchSideOfSideNumber(sideNumber: number): MatchSide {
  return sideNumber === 2 ? MatchSide.HOME : MatchSide.AWAY;
}

/** The team on the side the API still calls HOME or AWAY (`sideNumberOfMatchSide`), until part b names sides by number. */
export function teamOnMatchSide(match: MatchWithSides, side: MatchSide): string | null {
  return sideParticipantId(match, sideNumberOfMatchSide(side));
}

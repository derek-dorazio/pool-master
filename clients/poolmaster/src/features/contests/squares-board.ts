import {
  MATCH_PERIOD_LAYOUTS,
  MatchPeriodLayout,
  MatchStatus,
  SQUARES_GRID_SIZE,
  assertNever,
  isMatchUnplayed, isSquaresRound, pluralize 
} from '@poolmaster/shared/domain';
import type {
  SportEventMatchDto,
  SportEventParticipantDto,
  SquaresBoardResponse,
  SquaresBoxDto,
  SquaresWinnerDto,
} from '@/lib/api';

/** The grid's positions, top to bottom and left to right. */
export const SQUARES_POSITIONS = Array.from({ length: SQUARES_GRID_SIZE }, (_, index) => index);

/** A grid position's key, so a box and a winning box can be looked up by place. */
export function squaresBoxKey(rowIndex: number, columnIndex: number) {
  return `${rowIndex}:${columnIndex}`;
}

/** The board's claimed boxes by place. */
export function boxesByPlace(boxes: readonly SquaresBoxDto[]): ReadonlyMap<string, SquaresBoxDto> {
  return new Map(boxes.map((box) => [squaresBoxKey(box.rowIndex, box.columnIndex), box]));
}

/** The scoring moments each winning box won, by place: one box can win several. */
export function winningPeriodsByPlace(winners: readonly SquaresWinnerDto[]): ReadonlyMap<string, number[]> {
  const byPlace = new Map<string, number[]>();
  for (const winner of winners) {
    const key = squaresBoxKey(winner.rowIndex, winner.columnIndex);
    byPlace.set(key, [...(byPlace.get(key) ?? []), winner.periodNumber]);
  }
  return byPlace;
}

/** A period's short name, the letter the game's layout counts in and its number: Q2, H1, P3. */
function periodShortName(periodNumber: number, layout: MatchPeriodLayout) {
  switch (layout) {
    case MatchPeriodLayout.QUARTERS:
      return `Q${periodNumber}`;
    case MatchPeriodLayout.HALVES:
      return `H${periodNumber}`;
    case MatchPeriodLayout.THREE_PERIODS:
      return `P${periodNumber}`;
    default:
      return assertNever(layout, 'match period layout');
  }
}

/**
 * The tag a winning box wears on the board (#1758): the period it won by its short name (Q1, Q2,
 * Q3), and Final for the last, overtime included.
 */
export function squaresMomentTag(periodNumber: number, layout: MatchPeriodLayout) {
  return periodNumber >= MATCH_PERIOD_LAYOUTS[layout].count ? 'Final' : periodShortName(periodNumber, layout);
}

/** "4 of 10 boxes": how many of the boxes it may claim an entry holds. */
export function formatClaimedCount(claimed: number, limit: number) {
  return `${claimed} of ${pluralize(limit, 'box', 'boxes')}`;
}

/** How many boxes of the grid are claimed: "37 of 100 boxes taken". */
export function formatGridTaken(claimed: number) {
  return `${claimed} of ${SQUARES_GRID_SIZE * SQUARES_GRID_SIZE} boxes taken`;
}

/** One row of the winners list: a scoring moment with its score and winning box once it is in. */
export type SquaresMomentRow = {
  periodNumber: number;
  /** Its short tag, as on the board's winning box: Q1, Q2, Q3, Final. */
  tag: string;
  winner: SquaresWinnerDto | null;
};

/** Every scoring moment of the game in order, each with its winner once scored. */
export function squaresMomentRows(board: Pick<SquaresBoardResponse, 'winners' | 'periodLayout'>): SquaresMomentRow[] {
  return Array.from({ length: MATCH_PERIOD_LAYOUTS[board.periodLayout].count }, (_, index) => {
    const periodNumber = index + 1;
    return {
      periodNumber,
      tag: squaresMomentTag(periodNumber, board.periodLayout),
      winner: board.winners.find((winner) => winner.periodNumber === periodNumber) ?? null,
    };
  });
}

/** A team's name for a game side, or the words for a side still to be decided. */
function sideName(participantId: string | null, namesById: ReadonlyMap<string, string>) {
  return participantId === null ? 'To be decided' : namesById.get(participantId) ?? 'To be decided';
}

/** "Chiefs @ Eagles", or "vs" at a neutral site: how a game is named in the picker. */
export function formatSquaresGameTeams(game: SportEventMatchDto, namesById: ReadonlyMap<string, string>) {
  const away = sideName(game.awaySportEventParticipantId, namesById);
  const home = sideName(game.homeSportEventParticipantId, namesById);
  return `${away} ${game.isNeutralSite ? 'vs' : '@'} ${home}`;
}

/** The field's team names by field row. */
export function teamNamesById(field: readonly SportEventParticipantDto[]): ReadonlyMap<string, string> {
  return new Map(field.map((row) => [row.id, row.participant.name]));
}

/**
 * The games a squares contest can be played on (design §4.2): those still to kick off (a postponed game too), with no
 * period score in, and in a round of single games (from the sport league's `squaresFromRound`), the
 * final first, then by kickoff. The server checks the same at create.
 */
export function squaresGameChoices(games: readonly SportEventMatchDto[], now: Date, squaresFromRound: number | null = null): SportEventMatchDto[] {
  const kickoff = (game: SportEventMatchDto) => (game.scheduledDate === null ? Number.POSITIVE_INFINITY : Date.parse(game.scheduledDate));
  return games
    .filter((game) => isMatchUnplayed(game.status)
      && game.periodScores.length === 0
      && isSquaresRound(squaresFromRound, game.roundNumber)
      && (game.scheduledDate === null || Date.parse(game.scheduledDate) > now.getTime()))
    .sort((left, right) => Number(left.advancesToMatchId !== null) - Number(right.advancesToMatchId !== null)
      || kickoff(left) - kickoff(right)
      || left.matchNumber - right.matchNumber);
}

/** A side's points in each period and in all, for the score-by-quarter table (#1758). */
export type SquaresPeriodScoreLine = {
  /** Each period's points, first to last; null for a period not started. The last includes overtime. */
  periods: (number | null)[];
  /** The score so far; null before kickoff. */
  total: number | null;
};

/** The score by period (#1758): each side's points in each period, the period being played, and the totals. */
export type SquaresScoreByPeriod = {
  /** Each period's short name: Q1 to Q4, H1 and H2, or P1 to P3. */
  periodNames: string[];
  away: SquaresPeriodScoreLine;
  home: SquaresPeriodScoreLine;
  /** The period being played while the game is live; null before kickoff and once it is over. */
  livePeriodNumber: number | null;
};

/** The period being played: the one after the last whose score is in, while the game is live. */
function livePeriodNumber(game: SportEventMatchDto, layout: MatchPeriodLayout) {
  return game.status === MatchStatus.IN_PROGRESS
    ? Math.min(game.periodScores.length + 1, MATCH_PERIOD_LAYOUTS[layout].count)
    : null;
}

/**
 * The game's score by period (#1758), from the score at each period's end and the game's score
 * now: a period's points are its end score less the one before, the period being played counts
 * from the score now, and the last period runs to the final score, overtime included. Before
 * kickoff every period and total is null.
 */
export function squaresScoreByPeriod(game: SportEventMatchDto, layout: MatchPeriodLayout): SquaresScoreByPeriod {
  const count = MATCH_PERIOD_LAYOUTS[layout].count;
  const live = livePeriodNumber(game, layout);
  const endScores = new Map(game.periodScores.map((score) => [score.periodNumber, score]));
  const line = (side: 'home' | 'away'): SquaresPeriodScoreLine => {
    const scoreNow = side === 'home' ? game.homeScore : game.awayScore;
    // The score at the end of each period: the recorded one, else the score now for the live or last period.
    const endOf = (periodNumber: number) => {
      const recorded = endScores.get(periodNumber);
      if (recorded) {
        return side === 'home' ? recorded.homeScore : recorded.awayScore;
      }
      const runsToScoreNow = periodNumber === live || (periodNumber === count && game.status === MatchStatus.COMPLETED);
      return runsToScoreNow ? scoreNow : null;
    };
    const periods = Array.from({ length: count }, (_, index) => {
      const end = endOf(index + 1);
      const before = index === 0 ? 0 : endOf(index);
      return end === null || before === null ? null : end - before;
    });
    const lastRecorded = game.periodScores.at(-1);
    const recordedTotal = lastRecorded ? (side === 'home' ? lastRecorded.homeScore : lastRecorded.awayScore) : null;
    return { periods, total: scoreNow ?? recordedTotal };
  };
  return {
    periodNames: Array.from({ length: count }, (_, index) => periodShortName(index + 1, layout)),
    away: line('away'),
    home: line('home'),
    livePeriodNumber: live,
  };
}

/** The box winning the period being played, by the score now (#1758). */
export type SquaresLiveBox = {
  periodNumber: number;
  rowIndex: number;
  columnIndex: number;
};

/**
 * The box that would win the period being played if it ended now (#1758): the row of the away
 * score's last digit and the column of the home score's. Null unless the digits are drawn and the
 * game is live with a score.
 */
export function squaresLiveBox(board: Pick<SquaresBoardResponse, 'digits' | 'game' | 'periodLayout'>): SquaresLiveBox | null {
  const periodNumber = livePeriodNumber(board.game, board.periodLayout);
  const { homeScore, awayScore } = board.game;
  if (periodNumber === null || board.digits === null || homeScore === null || awayScore === null) {
    return null;
  }
  return {
    periodNumber,
    rowIndex: board.digits.rowDigits.indexOf(awayScore % 10),
    columnIndex: board.digits.columnDigits.indexOf(homeScore % 10),
  };
}

import {
  MATCH_PERIOD_LAYOUTS,
  MatchPeriodLayout,
  MatchStatus,
  SQUARES_GRID_SIZE,
  assertNever,
} from '@poolmaster/shared/domain';
import type {
  SportEventMatchDto,
  SportEventParticipantDto,
  SquaresBoardResponse,
  SquaresBoxDto,
  SquaresWinnerDto,
} from '@/lib/api';
import { pluralize } from './contest-rules';

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

/**
 * What a scoring moment is called (design §1), by the game's period layout: a quarters game's are
 * Q1, Halftime, Q3 and Final, a halves game's Halftime and Final. The last is Final, which
 * includes overtime.
 */
export function squaresMomentLabel(periodNumber: number, layout: MatchPeriodLayout) {
  if (periodNumber >= MATCH_PERIOD_LAYOUTS[layout].count) {
    return 'Final';
  }
  switch (layout) {
    case MatchPeriodLayout.QUARTERS:
      return ['Q1', 'Halftime', 'Q3'][periodNumber - 1] ?? `Q${periodNumber}`;
    case MatchPeriodLayout.HALVES:
      return 'Halftime';
    default:
      return assertNever(layout, 'match period layout');
  }
}

/** "4 of 10 boxes claimed": how many of its boxes an entry holds. */
export function formatClaimedCount(claimed: number, limit: number) {
  return `${claimed} of ${pluralize(limit, 'box', 'boxes')} claimed`;
}

/** How many boxes of the grid are claimed: "37 of 100 boxes taken". */
export function formatGridTaken(claimed: number) {
  return `${claimed} of ${SQUARES_GRID_SIZE * SQUARES_GRID_SIZE} boxes taken`;
}

/** One row of the winners list: a scoring moment with its score and winning box once it is in. */
export type SquaresMomentRow = {
  periodNumber: number;
  label: string;
  winner: SquaresWinnerDto | null;
};

/** Every scoring moment of the game in order, each with its winner once scored. */
export function squaresMomentRows(board: Pick<SquaresBoardResponse, 'winners' | 'periodLayout'>): SquaresMomentRow[] {
  return Array.from({ length: MATCH_PERIOD_LAYOUTS[board.periodLayout].count }, (_, index) => {
    const periodNumber = index + 1;
    return {
      periodNumber,
      label: squaresMomentLabel(periodNumber, board.periodLayout),
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
 * The games a squares contest can be played on (design §4.2): those still to kick off, with no
 * period score in, the final first, then by kickoff. The server checks the same at create.
 */
export function squaresGameChoices(games: readonly SportEventMatchDto[], now: Date): SportEventMatchDto[] {
  const kickoff = (game: SportEventMatchDto) => (game.scheduledDate === null ? Number.POSITIVE_INFINITY : Date.parse(game.scheduledDate));
  return games
    .filter((game) => game.status === MatchStatus.SCHEDULED
      && game.periodScores.length === 0
      && (game.scheduledDate === null || Date.parse(game.scheduledDate) > now.getTime()))
    .sort((left, right) => Number(left.advancesToMatchId !== null) - Number(right.advancesToMatchId !== null)
      || kickoff(left) - kickoff(right)
      || left.matchNumber - right.matchNumber);
}

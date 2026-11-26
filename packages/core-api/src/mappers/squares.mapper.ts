/**
 * Squares mapper (#711) — a squares contest's grid → its DTO, dates as ISO strings.
 */

import type { SquaresBoardResponse } from '@poolmaster/shared/dto/squares.dto';
import type { SquaresBoard } from '../modules/selections/squares-service';
import { mapSportEventRoundMatchToDto } from './sport-event-matches.mapper';

export function toSquaresBoardResponse(board: SquaresBoard): SquaresBoardResponse {
  return {
    contestId: board.contest.id,
    contestStatus: board.contest.status,
    maxSquaresPerEntry: board.maxSquaresPerEntry,
    periods: { unit: board.periods.unit, count: board.periods.count },
    game: mapSportEventRoundMatchToDto(board.game),
    rowTeamName: board.rowTeamName,
    columnTeamName: board.columnTeamName,
    claimsOpen: board.claimsOpen,
    drawOpen: board.drawOpen,
    boxes: board.boxes,
    digits: board.digits && {
      rowDigits: [...board.digits.rowDigits],
      columnDigits: [...board.digits.columnDigits],
      drawnAt: board.digits.drawnAt.toISOString(),
    },
    // The winners move to sides with #2019: rows are side 1's digits (the away team's), columns side 2's.
    winners: board.winners.map(({ homeScore, awayScore, ...winner }) => ({ ...winner, rowScore: awayScore, columnScore: homeScore })),
    entries: board.entries,
  };
}

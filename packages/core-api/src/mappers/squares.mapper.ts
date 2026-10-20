/**
 * Squares mapper (#711) — a squares contest's grid → its DTO, dates as ISO strings.
 */

import type { SquaresBoardResponse } from '@poolmaster/shared/dto/squares.dto';
import type { SquaresBoard } from '../modules/selections/squares-service';
import { mapSportEventMatchToDto } from './sport-event-matches.mapper';

export function toSquaresBoardResponse(board: SquaresBoard): SquaresBoardResponse {
  return {
    contestId: board.contest.id,
    contestStatus: board.contest.status,
    maxSquaresPerEntry: board.maxSquaresPerEntry,
    periodCount: board.periodCount,
    game: mapSportEventMatchToDto(board.game),
    homeTeamName: board.homeTeamName,
    awayTeamName: board.awayTeamName,
    claimsOpen: board.claimsOpen,
    drawOpen: board.drawOpen,
    boxes: board.boxes,
    digits: board.digits && {
      rowDigits: [...board.digits.rowDigits],
      columnDigits: [...board.digits.columnDigits],
      drawnAt: board.digits.drawnAt.toISOString(),
    },
    winners: board.winners,
    entries: board.entries,
  };
}

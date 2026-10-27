/**
 * A squares contest's contract (#711, plans/super-bowl-squares.md §4.1): the grid with its claimed
 * boxes, the digits once drawn, the game and its scores, and each scoring moment's winning box.
 * One read serves the claim screen and the live and Final board.
 */
import { z } from 'zod';
import { ContestStatus, MatchPeriodLayout, SQUARES_GRID_SIZE, SQUARES_PER_ENTRY_MAX } from '@poolmaster/shared/domain';
import { SportEventMatchDtoSchema } from './bracket.dto';
import { registerSchema } from './schema-registry';

/** Error code for a box someone else claimed first. */
export const SQUARES_BOX_TAKEN = 'SQUARES_BOX_TAKEN';
/** Error code for a claim past the contest's box limit per entry. */
export const SQUARES_BOX_LIMIT_REACHED = 'SQUARES_BOX_LIMIT_REACHED';
/** Error code for clearing a box nobody holds. */
export const SQUARES_BOX_NOT_CLAIMED = 'SQUARES_BOX_NOT_CLAIMED';
/** Error code for a claim or clear once claiming is closed: not OPEN, drawn, or the game has kicked off. */
export const SQUARES_CLAIMING_CLOSED = 'SQUARES_CLAIMING_CLOSED';
/** Error code for drawing digits a second time. */
export const SQUARES_ALREADY_DRAWN = 'SQUARES_ALREADY_DRAWN';
/** Error code for a draw once it is closed: the contest is not OPEN or live, or the first period's score is in. */
export const SQUARES_DRAW_CLOSED = 'SQUARES_DRAW_CLOSED';

const gridIndex = z.number().int().min(0).max(SQUARES_GRID_SIZE - 1);

export const SquaresBoxDtoSchema = z.object({
  rowIndex: gridIndex.describe('The row position, 0 at the top. Rows are the away team\'s.'),
  columnIndex: gridIndex.describe('The column position, 0 at the left. Columns are the home team\'s.'),
  contestEntryId: z.uuid().describe('The entry holding the box.'),
  entryName: z.string().describe('The entry\'s name, which is its squad\'s.'),
}).describe('A claimed box of the grid. A box not listed is empty.');
export type SquaresBoxDto = z.infer<typeof SquaresBoxDtoSchema>;

export const SquaresDigitsDtoSchema = z.object({
  rowDigits: z.array(z.number().int().min(0).max(9)).length(SQUARES_GRID_SIZE).describe('The away team\'s last digit at each row position, top first.'),
  columnDigits: z.array(z.number().int().min(0).max(9)).length(SQUARES_GRID_SIZE).describe('The home team\'s last digit at each column position, left first.'),
  drawnAt: z.iso.datetime().describe('When the digits were drawn: claiming closed then.'),
}).describe('The digits drawn along the two sides of the grid.');
export type SquaresDigitsDto = z.infer<typeof SquaresDigitsDtoSchema>;

export const SquaresWinnerDtoSchema = z.object({
  periodNumber: z.number().int().min(1).describe('The scoring moment: 1 to the game\'s period count, the last being the final score, overtime included.'),
  homeScore: z.number().int().min(0),
  awayScore: z.number().int().min(0),
  rowIndex: gridIndex.describe('The winning box\'s row: where the away score\'s last digit is.'),
  columnIndex: gridIndex.describe('The winning box\'s column: where the home score\'s last digit is.'),
  contestEntryId: z.uuid().nullable().describe('The entry holding the winning box; null when nobody claimed it ("No winner").'),
  entryName: z.string().nullable().describe('That entry\'s name; null with no entry.'),
}).describe('One scoring moment\'s winning box.');
export type SquaresWinnerDto = z.infer<typeof SquaresWinnerDtoSchema>;

export const SquaresEntryDtoSchema = z.object({
  contestEntryId: z.uuid(),
  entryName: z.string(),
  boxCount: z.number().int().min(0).describe('How many boxes the entry holds.'),
  periodsWon: z.number().int().min(0).describe('How many scoring moments its boxes won so far.'),
  displayPosition: z.string().nullable().describe('Its settled place, "T1" when shared; null until the contest is Final.'),
}).describe('One entry of the contest with its boxes and wins.');
export type SquaresEntryDto = z.infer<typeof SquaresEntryDtoSchema>;

export const SquaresBoardResponseSchema = z.object({
  contestId: z.uuid(),
  contestStatus: z.enum(ContestStatus),
  maxSquaresPerEntry: z.number().int().min(1).max(SQUARES_PER_ENTRY_MAX).describe('How many boxes one entry may claim.'),
  periodLayout: z.enum(MatchPeriodLayout).describe('The periods the game is played in, its sport league\'s (QUARTERS, or HALVES for men\'s college basketball): a scoring moment ends each period, the last being the final score.'),
  game: SportEventMatchDtoSchema.describe('The game the contest is played on, with its score at the end of each period and its final result.'),
  homeTeamName: z.string().nullable().describe('The home team, across the top; null until it is known.'),
  awayTeamName: z.string().nullable().describe('The away team, down the side; null until it is known.'),
  claimsOpen: z.boolean().describe('Whether boxes can be claimed and cleared now: the contest is OPEN, its digits are not drawn and the game has not kicked off.'),
  drawOpen: z.boolean().describe('Whether the digits can be drawn now: not drawn yet, the contest OPEN or live, and the first period\'s score not in.'),
  boxes: z.array(SquaresBoxDtoSchema).describe('Every claimed box, by row then column.'),
  digits: SquaresDigitsDtoSchema.nullable().describe('The digits; null until they are drawn.'),
  winners: z.array(SquaresWinnerDtoSchema).describe('Each scoring moment\'s winning box so far, by period: empty until the digits are drawn. Frozen once the contest is Final.'),
  entries: z.array(SquaresEntryDtoSchema).describe('The contest\'s entries, by place once Final, else by name.'),
}).describe('A squares contest\'s grid.');
export type SquaresBoardResponse = z.infer<typeof SquaresBoardResponseSchema>;

export const ClaimSquaresBoxRequestSchema = z.object({
  contestEntryId: z.uuid().describe('The entry the box is claimed for: the caller\'s own, or any entry when the caller is the commissioner.'),
}).describe('Claim one box of the grid.');
export type ClaimSquaresBoxRequest = z.infer<typeof ClaimSquaresBoxRequestSchema>;

registerSchema('SquaresBoxDto', SquaresBoxDtoSchema);
registerSchema('SquaresDigitsDto', SquaresDigitsDtoSchema);
registerSchema('SquaresWinnerDto', SquaresWinnerDtoSchema);
registerSchema('SquaresEntryDto', SquaresEntryDtoSchema);
registerSchema('SquaresBoardResponse', SquaresBoardResponseSchema);
registerSchema('ClaimSquaresBoxRequest', ClaimSquaresBoxRequestSchema);

import type { SquaresBoardResponse, SquaresBoxDto } from '@/lib/api';
import {
  BoardBand,
  BoardCellContent,
  boardAxisClassName,
  boardCellClassName,
  Button,
  DetailsPeek,
  formatEntryInitials,
  PeekCard,
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
} from '@/features/shared/ui';
import {
  SQUARES_POSITIONS,
  boxesByPlace,
  squaresBoxKey,
  squaresLiveBox,
  squaresMomentTag,
  winningPeriodsByPlace,
} from './squares-board';

/** What tapping a box does for the viewer: claim it, clear it, or nothing. */
export type SquaresBoxAction = 'claim' | 'clear' | null;

/** What the grid draws from the board read. */
export type SquaresGridBoard = Pick<
  SquaresBoardResponse,
  'awayTeamName' | 'boxes' | 'digits' | 'entries' | 'game' | 'homeTeamName' | 'periodLayout' | 'winners'
>;

/**
 * The 10x10 squares board (#711, redesigned in #1758): the home team across the top and the away
 * team down the side in navy bands, their digits beside the board ("?" until drawn). A claimed box
 * shows its entry's initials, so the whole board fits a phone; hovering or tapping it opens the
 * entry's full name and the box's numbers. The viewer's own boxes are shaded and outlined blue, as
 * their rows are on other boards; winning boxes are gold with the period they won on a tag ("Q1/F" for a box that won Q1 and the final), and while a period is played its score's row and column
 * are tinted and the box winning it now is outlined green with a Now tag. A box the viewer can
 * claim or clear is a button that does so instead. The boxes of an entry a link names (`?entry=`,
 * #1762) look as the viewer's own do.
 */
export function SquaresGrid({
  actionFor,
  board,
  isBusy,
  linkedEntryId = null,
  myEntryIds,
  onBoxAction,
}: {
  /** What a tap on this box does for the viewer; null leaves it read-only. */
  actionFor: (box: SquaresBoxDto | null) => SquaresBoxAction;
  board: SquaresGridBoard;
  isBusy: boolean;
  /** The entry a link names (`?entry=`), whose boxes are shaded and outlined as the viewer's own are. */
  linkedEntryId?: string | null;
  myEntryIds: readonly string[];
  onBoxAction: (rowIndex: number, columnIndex: number, action: Exclude<SquaresBoxAction, null>) => void;
}) {
  const boxes = boxesByPlace(board.boxes);
  const winningPeriods = winningPeriodsByPlace(board.winners);
  const live = squaresLiveBox(board);
  // From every entry of the contest, not only those holding a box, so a code never changes as others claim.
  const initials = formatEntryInitials(board.entries.map((entry) => ({ id: entry.contestEntryId, name: entry.entryName })));
  const homeTeam = board.homeTeamName ?? 'Home team';
  const awayTeam = board.awayTeamName ?? 'Away team';
  const digit = (digits: readonly number[] | undefined, index: number) => (digits ? String(digits[index]) : '?');
  // The box's numbers once drawn: "Chiefs 7 · Eagles 3", the away team's row first.
  const numbersOf = (rowIndex: number, columnIndex: number) => (board.digits
    ? `${awayTeam} ${board.digits.rowDigits[rowIndex]} · ${homeTeam} ${board.digits.columnDigits[columnIndex]}`
    : null);

  return (
    // A linked entry is shown by its boxes, so landing on it scrolls to the board.
    <div className="space-y-1" data-entry-id={linkedEntryId ?? undefined} data-testid="squares-grid">
      <SimpleTable className="table-fixed border-separate border-spacing-0.5" density="compact">
        <caption className="sr-only">{`${awayTeam} rows, ${homeTeam} columns`}</caption>
        <colgroup>
          <col className="w-5" />
          <col className="w-5 sm:w-7" />
          {SQUARES_POSITIONS.map((columnIndex) => <col key={columnIndex} />)}
        </colgroup>
        <TableHead tone="plain">
          <tr>
            <td aria-hidden colSpan={2} />
            <TableHeaderCell className="p-0" colSpan={SQUARES_POSITIONS.length} scope="colgroup">
              <BoardBand name={homeTeam} side="top" testId="squares-home-team" />
            </TableHeaderCell>
          </tr>
          <tr>
            <td aria-hidden colSpan={2} />
            {SQUARES_POSITIONS.map((columnIndex) => (
              <TableHeaderCell
                align="center"
                className={boardAxisClassName(live?.columnIndex === columnIndex)}
                data-testid={`squares-column-digit-${columnIndex}`}
                key={columnIndex}
              >
                {digit(board.digits?.columnDigits, columnIndex)}
              </TableHeaderCell>
            ))}
          </tr>
        </TableHead>
        <TableBody>
          {SQUARES_POSITIONS.map((rowIndex) => (
            <tr key={rowIndex}>
              {rowIndex === 0 ? (
                <TableHeaderCell className="relative p-0" rowSpan={SQUARES_POSITIONS.length} scope="rowgroup">
                  <BoardBand name={awayTeam} side="left" testId="squares-away-team" />
                </TableHeaderCell>
              ) : null}
              <TableHeaderCell
                align="center"
                className={boardAxisClassName(live?.rowIndex === rowIndex)}
                data-testid={`squares-row-digit-${rowIndex}`}
                scope="row"
              >
                {digit(board.digits?.rowDigits, rowIndex)}
              </TableHeaderCell>
              {SQUARES_POSITIONS.map((columnIndex) => {
                const key = squaresBoxKey(rowIndex, columnIndex);
                const box = boxes.get(key) ?? null;
                const action = actionFor(box);
                const isMine = box !== null && myEntryIds.includes(box.contestEntryId);
                const isLinked = box !== null && box.contestEntryId === linkedEntryId;
                const won = winningPeriods.get(key) ?? [];
                const isNow = live !== null && live.rowIndex === rowIndex && live.columnIndex === columnIndex;
                const isLiveLine = live !== null && (live.rowIndex === rowIndex || live.columnIndex === columnIndex);
                const numbers = numbersOf(rowIndex, columnIndex);
                const tags = won.map((periodNumber) => squaresMomentTag(periodNumber, board.periodLayout));
                const place = `Row ${rowIndex + 1}, column ${columnIndex + 1}`;
                const facts = [numbers, tags.length > 0 ? `won ${tags.join(', ')}` : null, isNow ? 'winning now' : null]
                  .filter((part) => part !== null);
                const peekFacts = [
                  ...(numbers === null ? [] : [{ label: 'Numbers', value: numbers }]),
                  ...(tags.length > 0 ? [{ label: 'Won', value: tags.join('/') }] : []),
                  ...(isNow ? [{ label: 'Now', value: 'Winning this period' }] : []),
                ];
                const label = box
                  ? `${[`${place}: ${box.entryName}`, ...facts].join(', ')}${action === 'clear' ? '. Tap to clear.' : ''}`
                  : `${[`${place}: empty`, ...facts].join(', ')}${action === 'claim' ? '. Tap to claim.' : ''}`;
                const look = boardCellClassName({ isEmpty: box === null, isMine: isMine || isLinked, isWon: won.length > 0, isNow, isOnLiveLine: isLiveLine });
                const tag = tags.length > 0
                  // Two or more tags shorten Final to F ("Q1/F"), so the tag stays inside its box on a phone.
                  ? { label: tags.length > 1 ? tags.map((each) => (each === 'Final' ? 'F' : each)).join('/') : tags[0], tone: 'won' as const }
                  : isNow ? { label: 'Now', tone: 'now' as const } : undefined;
                const content = <BoardCellContent code={box ? initials.get(box.contestEntryId) ?? '' : ''} tag={tag} />;
                const marks = {
                  'data-linked': isLinked || undefined,
                  'data-mine': isMine || undefined,
                  'data-now': isNow || undefined,
                  'data-testid': `squares-box-${rowIndex}-${columnIndex}`,
                  'data-winner': won.length > 0 || undefined,
                };
                return (
                  <TableCell className="p-0" key={columnIndex}>
                    {action !== null ? (
                      <div className={look}>
                        <Button
                          aria-label={label}
                          disabled={isBusy}
                          {...marks}
                          onClick={() => onBoxAction(rowIndex, columnIndex, action)}
                          size="cell"
                          variant="ghost"
                        >
                          {content}
                        </Button>
                      </div>
                    ) : box ? (
                      <DetailsPeek
                        className={look}
                        icon={<span className="flex size-full items-center justify-center" {...marks}>{content}</span>}
                        label={label}
                        testId={`squares-box-${rowIndex}-${columnIndex}-peek`}
                        trigger="cell"
                      >
                        <PeekCard facts={peekFacts} testId={`squares-box-${rowIndex}-${columnIndex}-card`} title={box.entryName} />
                      </DetailsPeek>
                    ) : (
                      <div aria-label={label} className={look} role="img" {...marks}>{content}</div>
                    )}
                  </TableCell>
                );
              })}
            </tr>
          ))}
        </TableBody>
      </SimpleTable>
    </div>
  );
}

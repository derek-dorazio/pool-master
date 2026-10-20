import type { SquaresBoardResponse, SquaresBoxDto } from '@/lib/api';
import { Button, cn } from '@/features/shared/ui';
import {
  SQUARES_POSITIONS,
  boxesByPlace,
  squaresBoxKey,
  winningPeriodsByPlace,
} from './squares-board';

/** What tapping a box does for the viewer: claim it, clear it, or nothing. */
export type SquaresBoxAction = 'claim' | 'clear' | null;

/**
 * The 10x10 squares grid (#711, design §4.2): the home team across the top with its digits, the
 * away team down the side with theirs, blank until drawn. A claimed box shows its entry's name,
 * the viewer's own highlighted; a winning box is outlined. On a phone the grid scrolls sideways
 * inside its card, with the digit row and column pinned.
 */
export function SquaresGrid({
  actionFor,
  board,
  isBusy,
  myEntryIds,
  onBoxAction,
}: {
  /** What a tap on this box does for the viewer; null leaves it read-only. */
  actionFor: (box: SquaresBoxDto | null) => SquaresBoxAction;
  board: Pick<SquaresBoardResponse, 'awayTeamName' | 'boxes' | 'digits' | 'homeTeamName' | 'winners'>;
  isBusy: boolean;
  myEntryIds: readonly string[];
  onBoxAction: (rowIndex: number, columnIndex: number, action: Exclude<SquaresBoxAction, null>) => void;
}) {
  const boxes = boxesByPlace(board.boxes);
  const winningPeriods = winningPeriodsByPlace(board.winners);
  const homeTeam = board.homeTeamName ?? 'Home team';
  const awayTeam = board.awayTeamName ?? 'Away team';
  const digit = (digits: readonly number[] | undefined, index: number) => (digits ? String(digits[index]) : '');

  return (
    <div className="space-y-2" data-testid="squares-grid">
      <div className="pl-16 text-center text-sm font-semibold" data-testid="squares-home-team">{homeTeam}</div>
      <div className="flex">
        <div
          className="flex w-6 shrink-0 items-center justify-center text-sm font-semibold [writing-mode:vertical-rl] rotate-180"
          data-testid="squares-away-team"
        >
          {awayTeam}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto" data-testid="squares-grid-scroll">
          <table className="border-separate border-spacing-0.5 text-xs">
            <caption className="sr-only">{`${awayTeam} rows, ${homeTeam} columns`}</caption>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 h-8 w-8 bg-card" scope="col">
                  <span className="sr-only">Digits</span>
                </th>
                {SQUARES_POSITIONS.map((columnIndex) => (
                  <th
                    className="sticky top-0 z-10 h-8 min-w-16 rounded-md bg-muted text-center text-sm font-semibold"
                    data-testid={`squares-column-digit-${columnIndex}`}
                    key={columnIndex}
                    scope="col"
                  >
                    {digit(board.digits?.columnDigits, columnIndex)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SQUARES_POSITIONS.map((rowIndex) => (
                <tr key={rowIndex}>
                  <th
                    className="sticky left-0 z-10 w-8 rounded-md bg-muted text-center text-sm font-semibold"
                    data-testid={`squares-row-digit-${rowIndex}`}
                    scope="row"
                  >
                    {digit(board.digits?.rowDigits, rowIndex)}
                  </th>
                  {SQUARES_POSITIONS.map((columnIndex) => {
                    const key = squaresBoxKey(rowIndex, columnIndex);
                    const box = boxes.get(key) ?? null;
                    const action = actionFor(box);
                    const isMine = box !== null && myEntryIds.includes(box.contestEntryId);
                    const won = winningPeriods.get(key) ?? [];
                    const place = `Row ${rowIndex + 1}, column ${columnIndex + 1}`;
                    const label = box
                      ? `${place}: ${box.entryName}${action === 'clear' ? '. Tap to clear.' : ''}`
                      : `${place}: empty${action === 'claim' ? '. Tap to claim.' : ''}`;
                    const className = cn(
                      'flex h-12 w-16 items-center justify-center rounded-md border px-1 py-0 text-center text-xs leading-tight',
                      box ? 'border-border bg-muted/40' : 'border-dashed border-border bg-background',
                      isMine && 'border-primary bg-primary/15 font-semibold',
                      won.length > 0 && 'ring-2 ring-accent ring-offset-1 ring-offset-background',
                    );
                    const content = <span className="line-clamp-2 break-words">{box?.entryName ?? ''}</span>;
                    const marks = {
                      'data-mine': isMine || undefined,
                      'data-testid': `squares-box-${rowIndex}-${columnIndex}`,
                      'data-winner': won.length > 0 || undefined,
                      title: box?.entryName,
                    };
                    return (
                      <td className="p-0" key={columnIndex}>
                        {action === null ? (
                          <div aria-label={label} className={className} role="img" {...marks}>{content}</div>
                        ) : (
                          <Button
                            aria-label={label}
                            className={cn(className, 'rounded-md font-normal hover:bg-primary/10', isMine && 'font-semibold')}
                            disabled={isBusy}
                            onClick={() => onBoxAction(rowIndex, columnIndex, action)}
                            size="sm"
                            variant="ghost"
                            {...marks}
                          >
                            {content}
                          </Button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

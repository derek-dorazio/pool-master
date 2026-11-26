import { Check } from 'lucide-react';
import { Icon, SimpleTable, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from '@/features/shared/ui';
import { EntryDetailsPeek } from './entry-details-peek';
import { MineMarker } from './mine-marker';
import type { SquaresMomentRow } from './squares-board';

/**
 * A squares board's winners (#711, a table since #1758), one row per scoring moment: its tag (Q1,
 * Q2, Q3, Final), the score that won it, the winning box's numbers, and the entry holding that
 * box with its team's (i), marked as the viewer's with Yours and a tick.
 */
export function SquaresWinners({
  rowTeamName,
  columnTeamName,
  leagueCode,
  leagueId,
  moments,
  myEntryIds,
  squadIdOf,
}: {
  rowTeamName: string;
  columnTeamName: string;
  leagueCode: string;
  leagueId: string;
  moments: readonly SquaresMomentRow[];
  myEntryIds: readonly string[];
  /** The team of a winning entry, for its (i). */
  squadIdOf: (contestEntryId: string | null) => string | undefined;
}) {
  return (
    <SimpleTable data-testid="squares-winners" density="compact">
      <caption className="sr-only">Winners</caption>
      <TableHead>
        <tr>
          <TableHeaderCell><span className="sr-only">Period</span></TableHeaderCell>
          <TableHeaderCell>Score</TableHeaderCell>
          <TableHeaderCell>Box</TableHeaderCell>
          <TableHeaderCell>Winner</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {moments.map(({ periodNumber, tag, winner }) => {
          const isMine = winner !== null && winner.contestEntryId !== null && myEntryIds.includes(winner.contestEntryId);
          const squadId = winner ? squadIdOf(winner.contestEntryId) : undefined;
          return (
            <TableRow data-mine={isMine || undefined} data-testid={`squares-winner-${periodNumber}`} isHighlighted={isMine} key={periodNumber}>
              <TableHeaderCell scope="row"><Text variant="strong" weight="semibold">{tag}</Text></TableHeaderCell>
              {winner ? (
                <>
                  <TableCell>{`${rowTeamName} ${winner.rowScore}, ${columnTeamName} ${winner.columnScore}`}</TableCell>
                  <TableCell>{`${rowTeamName} ${winner.rowScore % 10} · ${columnTeamName} ${winner.columnScore % 10}`}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      <Text variant="strong" weight="semibold">{winner.entryName ?? 'No winner'}</Text>
                      {winner.entryName !== null && squadId ? (
                        <EntryDetailsPeek className="-my-2" entryName={winner.entryName} leagueCode={leagueCode} leagueId={leagueId} squadId={squadId} testId={`squares-winner-${periodNumber}-peek`} />
                      ) : null}
                      {isMine ? (
                        <>
                          <MineMarker />
                          <Icon data-testid={`squares-winner-${periodNumber}-won`} icon={Check} size={16} tone="done" />
                          <span className="sr-only">Won</span>
                        </>
                      ) : null}
                    </span>
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={3}><Text variant="meta">Not scored yet</Text></TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </SimpleTable>
  );
}

import { cn, SimpleTable, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from '@/features/shared/ui';
import type { SquaresPeriodScoreLine, SquaresScoreByPeriod } from './squares-board';

/** A point count, or a dash for a period not started. */
function points(value: number | null) {
  return value === null ? '–' : String(value);
}

/**
 * The squares game's score by period (#1758): one row per team, the away team first as on the
 * board, with each period's points and the total. The period being played is tinted.
 */
export function SquaresScoreTable({
  awayTeamName,
  homeTeamName,
  score,
}: {
  awayTeamName: string;
  homeTeamName: string;
  score: SquaresScoreByPeriod;
}) {
  const liveIndex = score.livePeriodNumber === null ? null : score.livePeriodNumber - 1;
  const tint = (index: number) => (index === liveIndex ? 'bg-done/10' : null);
  const line = (name: string, side: SquaresPeriodScoreLine, testId: string) => (
    <TableRow data-testid={testId}>
      <TableHeaderCell className="truncate" scope="row"><Text variant="strong" weight="semibold">{name}</Text></TableHeaderCell>
      {side.periods.map((value, index) => (
        <TableCell className={cn(tint(index))} data-testid={`${testId}-period-${index + 1}`} key={score.periodNames[index]} numeric>
          {points(value)}
        </TableCell>
      ))}
      <TableCell data-testid={`${testId}-total`} numeric><Text variant="strong" weight="bold">{points(side.total)}</Text></TableCell>
    </TableRow>
  );

  return (
    <SimpleTable className="table-fixed" data-testid="squares-score-table" density="compact">
      <caption className="sr-only">Score by period</caption>
      <TableHead>
        <tr>
          <TableHeaderCell className="w-2/5"><span className="sr-only">Team</span></TableHeaderCell>
          {score.periodNames.map((name, index) => (
            <TableHeaderCell className={cn(tint(index))} data-live={index === liveIndex || undefined} data-testid={`squares-score-head-${index + 1}`} key={name} numeric>
              {name}
            </TableHeaderCell>
          ))}
          <TableHeaderCell numeric>Total</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {line(awayTeamName, score.away, 'squares-score-away')}
        {line(homeTeamName, score.home, 'squares-score-home')}
      </TableBody>
    </SimpleTable>
  );
}

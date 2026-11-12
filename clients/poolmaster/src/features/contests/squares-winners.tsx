import { Eyebrow, SectionCard, Text } from '@/features/shared/ui';
import { EntryDetailsPeek } from './entry-details-peek';
import type { SquaresMomentRow } from './squares-board';

/** A quarter's winning entry by name, with the (i) for its team once there is a winner to name. */
function WinnerEntry({ entryName, leagueCode, leagueId, squadId, testId }: {
  entryName: string | null;
  leagueCode: string;
  leagueId: string;
  squadId: string | undefined;
  testId: string;
}) {
  return (
    <div className="flex items-center">
      <Text variant="strong" weight="semibold">{entryName ?? 'No winner'}</Text>
      {entryName !== null && squadId ? (
        <EntryDetailsPeek className="-my-2" entryName={entryName} leagueCode={leagueCode} leagueId={leagueId} squadId={squadId} testId={testId} />
      ) : null}
    </div>
  );
}

/**
 * A squares board's winners (#711), one box per quarter: its label, the winning entry with its
 * team's (i), and the score that won it, or "Not scored yet". Shown once the numbers are drawn.
 */
export function SquaresWinners({
  awayTeamName,
  homeTeamName,
  isFinal,
  leagueCode,
  leagueId,
  moments,
  squadIdOf,
}: {
  awayTeamName: string | null | undefined;
  homeTeamName: string | null | undefined;
  isFinal: boolean;
  leagueCode: string;
  leagueId: string;
  moments: readonly SquaresMomentRow[];
  /** The team of a winning entry, for its (i). */
  squadIdOf: (contestEntryId: string | null) => string | undefined;
}) {
  return (
    <SectionCard headingLevel={3} padded testId="squares-winners" title={isFinal ? 'Winners' : 'Winners so far'}>
      <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
        {moments.map((moment) => (
          <li
            className="rounded-lg border border-border px-3 py-2"
            data-testid={`squares-winner-${moment.periodNumber}`}
            key={moment.periodNumber}
          >
            <Eyebrow tone="muted">{moment.label}</Eyebrow>
            {moment.winner ? (
              <>
                <WinnerEntry
                  entryName={moment.winner.entryName}
                  leagueCode={leagueCode}
                  leagueId={leagueId}
                  squadId={squadIdOf(moment.winner.contestEntryId)}
                  testId={`squares-winner-${moment.periodNumber}-peek`}
                />
                <Text as="div" variant="meta">
                  {`${awayTeamName ?? 'Away'} ${moment.winner.awayScore}, ${homeTeamName ?? 'Home'} ${moment.winner.homeScore}`}
                </Text>
              </>
            ) : (
              <Text as="div" variant="meta">Not scored yet</Text>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

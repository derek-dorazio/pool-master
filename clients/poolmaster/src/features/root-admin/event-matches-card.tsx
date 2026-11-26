import { useMemo, useState } from 'react';
import type { SportEventDto } from '@/lib/api';
import { DataGrid, QueryState, refetchFailed, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { eventMatchColumns } from './event-match-columns';
import { EventMatchDialog } from './event-match-dialog';
import { eventMatchRows } from './event-match-rows';
import { useSportEventBracketQuery, useSportEventFieldQuery } from './use-sport-event';

/**
 * The Event page's Matches section (#1890), on an event played as matches (a week of games, a
 * bracket): every match in one grid, each ⤢ opening its dialog.
 */
export function EventMatchesCard({ event }: { event: SportEventDto }) {
  const bracketQuery = useSportEventBracketQuery(event.id);
  const fieldQuery = useSportEventFieldQuery(event.id);
  const columns = useMemo(() => eventMatchColumns(), []);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const rows = useMemo(() => {
    if (bracketQuery.data === undefined || fieldQuery.data === undefined) return undefined;
    return eventMatchRows(bracketQuery.data, fieldQuery.data);
  }, [bracketQuery.data, fieldQuery.data]);
  const failed = bracketQuery.isError ? bracketQuery : fieldQuery;

  return (
    <SectionCard headingLevel={3} padded testId="root-admin-event-matches" title="Matches">
      <QueryState
        error={extractErrorMessage(failed.error, { fallback: 'We could not load the matches right now.' })}
        loading="Loading matches..."
        query={{ data: rows, isError: bracketQuery.isError || fieldQuery.isError, refetch: refetchFailed(bracketQuery, fieldQuery) }}
        testId="root-admin-event-matches-state"
      >
        {(loaded) => {
          const openMatch = loaded.find((match) => match.id === openMatchId);
          return (
            <>
              <DataGrid
                columns={columns}
                data={loaded}
                emptyMessage="No matches yet."
                filterTestIdPrefix="root-admin-event-matches-filter"
                getRowId={(match) => match.id}
                openRowDialog={(match) => setOpenMatchId(match.id)}
                rowTestId={(match) => `root-admin-event-match-${String(match.matchNumber)}`}
                tableTestId="root-admin-event-matches-table"
                urlKey="matches"
              />
              {openMatch === undefined ? null : <EventMatchDialog eventId={event.id} key={openMatch.id} onClose={() => setOpenMatchId(null)} row={openMatch} />}
            </>
          );
        }}
      </QueryState>
    </SectionCard>
  );
}

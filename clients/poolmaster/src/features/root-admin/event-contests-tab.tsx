import { useMemo, useState } from 'react';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/plural';
import { eventContestColumns } from './event-contest-columns';
import { EventContestDialog } from './event-contest-dialog';
import { useEventPage } from './event-page-context';
import { useSportEventContestsQuery } from './use-event-page';

/**
 * The Event page's Contests tab (#1890): every customer contest on the event, across every
 * league, in one read-only grid; ⤢ opens a contest's dialog.
 */
export function EventContestsTab() {
  const { event } = useEventPage();
  const contestsQuery = useSportEventContestsQuery(event.id);
  const [openContestId, setOpenContestId] = useState<string | null>(null);
  const columns = useMemo(() => eventContestColumns(), []);
  const contests = contestsQuery.data;
  // poolmaster-allow-list-lookup: one lookup on the grid's own rows when the dialog opens
  const openContest = contests?.find((contest) => contest.id === openContestId);

  return (
    <SectionCard
      padded
      testId="root-admin-event-contests"
      title="Contests"
      trailing={contests ? <span data-testid="root-admin-event-contests-count">{plural(contests.length, 'contest')}</span> : undefined}
    >
      <QueryState
        error={extractErrorMessage(contestsQuery.error, { fallback: 'We could not load the contests right now.' })}
        loading="Loading contests..."
        query={contestsQuery}
        testId="root-admin-event-contests-state"
      >
        {(loaded) => (
          <DataGrid
            columns={columns}
            data={loaded}
            emptyMessage="No contests on this event yet."
            filterTestIdPrefix="root-admin-event-contests-filter"
            getRowId={(contest) => contest.id}
            openRowDialog={(contest) => setOpenContestId(contest.id)}
            rowTestId={(contest) => `root-admin-event-contest-${contest.id}`}
            tableTestId="root-admin-event-contests-table"
            urlKey="contests"
          />
        )}
      </QueryState>
      {openContest ? <EventContestDialog contest={openContest} onClose={() => setOpenContestId(null)} /> : null}
    </SectionCard>
  );
}

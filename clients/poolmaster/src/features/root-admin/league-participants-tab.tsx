import { useMemo, useState } from 'react';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/plural';
import { leagueParticipantColumnIds, leagueParticipantColumns } from './league-participant-columns';
import { LeagueParticipantDialog } from './league-participant-dialog';
import { useLeaguePage } from './league-page-context';
import { useSportLeagueParticipantOverviewsQuery } from './use-sport-league-page';

/**
 * The League page's Participants tab (#1866): every participant of the league in one grid, its
 * columns fitting the league's kind; ⤢ opens a participant's dialog.
 */
export function LeagueParticipantsTab() {
  const { sportLeague } = useLeaguePage();
  const participantsQuery = useSportLeagueParticipantOverviewsQuery(sportLeague.id);
  const [openParticipantId, setOpenParticipantId] = useState<string | null>(null);
  const participants = participantsQuery.data;
  const columns = useMemo(
    () => leagueParticipantColumns(leagueParticipantColumnIds(participants ?? [])),
    [participants],
  );
  // poolmaster-allow-list-lookup: one lookup on the grid's own rows when the dialog opens
  const openParticipant = participants?.find((participant) => participant.id === openParticipantId);

  return (
    <SectionCard
      padded
      testId="root-admin-league-participants"
      title="Participants"
      trailing={participants ? <span data-testid="root-admin-league-participants-count">{plural(participants.length, 'participant')}</span> : undefined}
    >
      <QueryState
        error={extractErrorMessage(participantsQuery.error, { fallback: 'We could not load the participants right now.' })}
        loading="Loading participants..."
        query={participantsQuery}
        testId="root-admin-league-participants-state"
      >
        {(loaded) => (
          <DataGrid
            columns={columns}
            data={loaded}
            emptyMessage="No participants yet."
            filterTestIdPrefix="root-admin-league-participants-filter"
            getRowId={(participant) => participant.id}
            openRowDialog={(participant) => setOpenParticipantId(participant.id)}
            rowTestId={(participant) => `root-admin-league-participant-${participant.id}`}
            tableTestId="root-admin-league-participants-table"
            urlKey="participants"
          />
        )}
      </QueryState>
      {openParticipant ? (
        <LeagueParticipantDialog
          onClose={() => setOpenParticipantId(null)}
          participant={openParticipant}
          sportLeagueId={sportLeague.id}
          sportLeagueName={sportLeague.name}
        />
      ) : null}
    </SectionCard>
  );
}

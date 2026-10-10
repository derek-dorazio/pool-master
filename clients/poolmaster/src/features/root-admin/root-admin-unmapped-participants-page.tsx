import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { type UnmappedProviderParticipantDto } from '@/lib/api';
import { DataGridPage, LinkButton } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { ManagePageIntro } from './manage-page-intro';
import { MANAGE_LIST_PAGE_SIZE, buildMapCompetitorPath } from './manage-navigation';
import { useUnmappedCompetitorsQuery } from './use-unmapped-competitors';

const columnHelper = createColumnHelper<UnmappedProviderParticipantDto>();

function rowKey(row: UnmappedProviderParticipantDto): string {
  return `${row.providerId}:${row.externalId}`;
}

/**
 * #205 — /manage/sync/unmapped-participants. A competitor a provider reports that no
 * participant is mapped to has nowhere for their synced scores to land, so the leaderboard
 * is quietly wrong rather than visibly broken. This lists them and binds each one to a
 * participant of the same sport, each on its own Map competitor page.
 */
export function RootAdminUnmappedParticipantsPage() {
  const unmappedQuery = useUnmappedCompetitorsQuery();

  const columns = useMemo(
    () => [
      columnHelper.accessor('externalName', {
        header: 'Competitor',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('sport', { header: 'Sport' }),
      columnHelper.accessor('providerName', { header: 'Provider' }),
      columnHelper.accessor('externalId', { header: 'Provider id' }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <LinkButton
            data-testid={`root-admin-unmapped-participant-map-${rowKey(row.original)}`}
            to={buildMapCompetitorPath(row.original.providerId, row.original.externalId)}
            variant="secondary"
          >
            Map
          </LinkButton>
        ),
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-unmapped-participants-page">
      <ManagePageIntro>
        Competitors a provider reports that no participant is mapped to. Their synced scores have
        nowhere to land until you bind each one to a participant.
      </ManagePageIntro>

      <DataGridPage
        columns={columns}
        data={unmappedQuery.data ?? []}
        emptyMessage="Every competitor the providers report is mapped to a participant."
        errorBody={extractErrorMessage(unmappedQuery.error, {
          fallback: 'We could not load unmapped competitors right now.',
        })}
        filterTestIdPrefix="root-admin-unmapped-participants-filter"
        getRowId={rowKey}
        loadingBody="Loading unmapped competitors..."
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(row) => `root-admin-unmapped-participant-row-${rowKey(row)}`}
        search={{ label: 'Find a competitor', testId: 'root-admin-unmapped-participants-search' }}
        state={unmappedQuery.isLoading ? 'loading' : unmappedQuery.isError ? 'error' : 'ready'}
        tableTestId="root-admin-unmapped-participants-table"
        testId="root-admin-unmapped-participants-grid"
      />
    </section>
  );
}

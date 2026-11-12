import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { type UnmappedProviderParticipantDto } from '@/lib/api';
import { DataGrid, HelpTip, Input, LinkButton, PageHeader, QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
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
  const [searchTerm, setSearchTerm] = useState('');

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
      <PageHeader
        search={(
          <Input
            aria-label="Find a competitor"
            data-testid="root-admin-unmapped-participants-search"
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Find a competitor"
            type="search"
            value={searchTerm}
          />
        )}
        testId="root-admin-unmapped-participants-header"
        title="Unmapped Competitors"
        titleAside={(
          <HelpTip label="About unmapped competitors" testId="root-admin-unmapped-participants-help">
            Competitors a provider reports that no participant is mapped to. Their synced scores
            have nowhere to land until you bind each one to a participant.
          </HelpTip>
        )}
      />
      <QueryState
        error={extractErrorMessage(unmappedQuery.error, {
          fallback: 'We could not load unmapped competitors right now.',
        })}
        loading="Loading unmapped competitors..."
        query={unmappedQuery}
        testId="root-admin-unmapped-participants"
      >
        {(unmapped) => (
          <DataGrid
            columns={columns}
            data={unmapped}
            emptyMessage="Every competitor the providers report is mapped to a participant."
            filterTestIdPrefix="root-admin-unmapped-participants-filter"
            getRowId={rowKey}
            pageSize={MANAGE_LIST_PAGE_SIZE}
            rowTestId={(row) => `root-admin-unmapped-participant-row-${rowKey(row)}`}
            searchTerm={searchTerm}
            tableTestId="root-admin-unmapped-participants-table"
          />
        )}
      </QueryState>
    </section>
  );
}

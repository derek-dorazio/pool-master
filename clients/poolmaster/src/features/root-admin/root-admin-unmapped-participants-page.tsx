import { createColumnHelper } from '@tanstack/react-table';
import { SportOrder } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { type UnmappedProviderParticipantDto } from '@/lib/api';
import { DataGrid, HelpTip, Input, PageHeader, QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { buildMapCompetitorPath } from './manage-navigation';
import { useUnmappedCompetitorsQuery } from './use-unmapped-competitors';

const columnHelper = createColumnHelper<UnmappedProviderParticipantDto>();

function rowKey(row: UnmappedProviderParticipantDto): string {
  return `${row.providerId}:${row.externalId}`;
}

/**
 * #205 — /manage/providers/unmapped-participants. A competitor a provider reports that no
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
        meta: { info: 'The name the provider sent for a participant it could not match to one we hold.', type: { kind: 'text' } },
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('sport', { header: 'Sport', meta: { info: 'The sport the provider sent the participant for.', type: { kind: 'enum', order: SportOrder } } }),
      columnHelper.accessor('providerName', { header: 'Provider', meta: { info: 'The data provider that sent the participant.', type: { kind: 'enum' } } }),
      columnHelper.accessor('externalId', { header: 'Provider id', meta: { info: "The provider's own id for the participant.", type: { kind: 'text' } } }),
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
        title="Unmapped participants"
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
            getRowLink={(row) => buildMapCompetitorPath(row.providerId, row.externalId)}
            rowTestId={(row) => `root-admin-unmapped-participant-row-${rowKey(row)}`}
            searchTerm={searchTerm}
            tableTestId="root-admin-unmapped-participants-table"
          />
        )}
      </QueryState>
    </section>
  );
}

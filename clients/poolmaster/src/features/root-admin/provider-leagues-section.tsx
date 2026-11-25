import { useMemo, useState } from 'react';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { ProviderSummaryDto } from '@/lib/api';
import { providerLeagueColumns, type ProviderLeagueRow } from './provider-league-columns';
import { ProviderLeagueDialog } from './provider-league-dialog';
import { sportDisplayOrder } from './sport-display-order';
import { useSportsQuery } from './use-sport-catalog';
import { useProviderSettingRanges, useProvidersQuery } from './use-providers-query';

/** Every provider's own leagues, each with its provider's name. */
function leagueRowsOf(providers: readonly ProviderSummaryDto[]): ProviderLeagueRow[] {
  return providers.flatMap((provider) => (provider.settings?.leagues ?? []).map((league) => ({
    ...league,
    providerId: provider.settings?.id ?? '',
    providerName: provider.providerName,
  })));
}

/**
 * The Providers page's provider leagues (#1997): every league a provider serves, from its rows, a
 * row opening its view-then-Edit dialog.
 */
export function ProviderLeaguesSection() {
  const providersQuery = useProvidersQuery();
  const ranges = useProviderSettingRanges();
  const [openLeagueId, setOpenLeagueId] = useState<string | null>(null);
  const sportsQuery = useSportsQuery();
  const columns = useMemo(() => providerLeagueColumns(sportDisplayOrder(sportsQuery.data ?? [])), [sportsQuery.data]);
  const rows = leagueRowsOf(providersQuery.data ?? []);
  const openLeague = rows.find((league) => league.id === openLeagueId);

  return (
    <SectionCard padded testId="root-admin-provider-leagues" title="Provider leagues">
      <QueryState
        error={extractErrorMessage(providersQuery.error, { fallback: 'We could not read the providers right now.' })}
        loading="Reading provider leagues..."
        query={providersQuery}
        testId="root-admin-provider-leagues-state"
      >
        {(providers) => (
          <DataGrid
            columns={columns}
            data={leagueRowsOf(providers)}
            emptyMessage="No provider has a league."
            filterTestIdPrefix="root-admin-provider-leagues-filter"
            getRowId={(league) => league.id}
            openRowDialog={(league) => setOpenLeagueId(league.id)}
            rowTestId={(league) => `root-admin-provider-league-${league.code}`}
            tableTestId="root-admin-provider-leagues-table"
            urlKey="providerLeagues"
          />
        )}
      </QueryState>
      {openLeague ? <ProviderLeagueDialog league={openLeague} onClose={() => setOpenLeagueId(null)} ranges={ranges} /> : null}
    </SectionCard>
  );
}

import { useState } from 'react';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { providerColumns } from './provider-columns';
import { ProviderDialog } from './provider-dialog';
import { useProvidersQuery } from './use-providers-query';

/**
 * The Providers page's providers (#1873): one row per provider with its live check, a row
 * opening its dialog, where its settings are edited (#1997).
 */
export function ProvidersSection() {
  const providersQuery = useProvidersQuery();
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);
  // poolmaster-allow-list-lookup: the handful of registered providers
  const openProvider = providersQuery.data?.find((provider) => provider.providerId === openProviderId);

  return (
    <SectionCard padded testId="root-admin-providers" title="Providers">
      <QueryState
        error={extractErrorMessage(providersQuery.error, { fallback: 'We could not check the providers right now.' })}
        loading="Checking providers..."
        query={providersQuery}
        testId="root-admin-providers-state"
      >
        {(providers) => (
          <DataGrid
            columns={providerColumns}
            data={providers}
            emptyMessage="No provider is configured."
            filterTestIdPrefix="root-admin-providers-filter"
            getRowId={(provider) => provider.providerId}
            openRowDialog={(provider) => setOpenProviderId(provider.providerId)}
            rowTestId={(provider) => `root-admin-provider-${provider.providerId}`}
            tableTestId="root-admin-providers-table"
            urlKey="providers"
          />
        )}
      </QueryState>
      {openProvider ? (
        <ProviderDialog
          checkedAt={new Date(providersQuery.dataUpdatedAt).toISOString()}
          isChecking={providersQuery.isFetching}
          onCheckNow={() => void providersQuery.refetch()}
          onClose={() => setOpenProviderId(null)}
          provider={openProvider}
        />
      ) : null}
    </SectionCard>
  );
}

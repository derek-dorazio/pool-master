import { PageHeader } from '@/features/shared/ui';
import { providersCountLine } from './provider-facts';
import { ProvidersSection } from './providers-section';
import { SyncSchedulesSection } from './sync-schedules-section';
import { useProvidersQuery } from './use-providers-query';

/**
 * /manage/providers (#1873): the sports data providers with their live check, and the one sync
 * schedule every sport league follows. Root admin, desktop only.
 */
export function RootAdminProvidersPage() {
  const providersQuery = useProvidersQuery();
  return (
    <section className="space-y-6" data-testid="root-admin-providers-page">
      <PageHeader
        meta={providersQuery.data
          ? <span data-testid="root-admin-providers-counts">{providersCountLine(providersQuery.data)}</span>
          : undefined}
        testId="root-admin-providers-header"
        title="Providers"
      />
      <ProvidersSection />
      <SyncSchedulesSection />
    </section>
  );
}

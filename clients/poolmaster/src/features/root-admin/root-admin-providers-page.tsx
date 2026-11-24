import { LinkButton, PageHeader } from '@/features/shared/ui';
import { RUN_EVENT_SYNC_PATH, UNMAPPED_COMPETITORS_PATH } from './manage-navigation';
import { providersCountLine } from './provider-facts';
import { ProviderLeaguesSection } from './provider-leagues-section';
import { ProvidersSection } from './providers-section';
import { SyncSchedulesSection } from './sync-schedules-section';
import { useProvidersQuery } from './use-providers-query';

/**
 * /manage/providers (#1873): the sports data providers with their live check and their settings,
 * their own leagues (#1997), and the one sync schedule every sport league follows, with Run event sync and Unmapped competitors in the header
 * (#1887). Root admin, desktop only.
 */
export function RootAdminProvidersPage() {
  const providersQuery = useProvidersQuery();
  return (
    <section className="space-y-6" data-testid="root-admin-providers-page">
      <PageHeader
        actions={(
          <>
            <LinkButton data-testid="root-admin-open-unmapped-participants-page" to={UNMAPPED_COMPETITORS_PATH} variant="subtle">
              Unmapped competitors
            </LinkButton>
            <LinkButton data-testid="root-admin-open-run-event-sync-page" to={RUN_EVENT_SYNC_PATH} variant="primary">
              Run event sync
            </LinkButton>
          </>
        )}
        meta={providersQuery.data
          ? <span data-testid="root-admin-providers-counts">{providersCountLine(providersQuery.data)}</span>
          : undefined}
        testId="root-admin-providers-header"
        title="Providers"
      />
      <ProvidersSection />
      <ProviderLeaguesSection />
      <SyncSchedulesSection />
    </section>
  );
}

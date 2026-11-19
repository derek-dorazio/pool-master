import { DataGrid, PageHeader, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { CustomerLeagueDialog } from './customer-league-dialog';
import { customerLeagueColumns } from './customer-league-columns';
import { CustomersPageTabs } from './customers-page-tabs';
import { CUSTOMER_LEAGUE_PARAM } from './manage-navigation';
import { useDialogSearchParam } from './use-dialog-search-param';
import { ExtendPreviewsButton } from './extend-previews-dialog';
import { useCustomerLeaguesQuery } from './use-customers-query';

/**
 * /manage/customers/leagues (#1883): every league on the platform in one grid, filtered from its
 * headers, each row opening its dialog, named in the address (?league=). Root admin, desktop only.
 */
export function RootAdminCustomerLeaguesPage() {
  const leaguesQuery = useCustomerLeaguesQuery();
  const [openId, setOpenId] = useDialogSearchParam(CUSTOMER_LEAGUE_PARAM);
  // poolmaster-allow-list-lookup: the dialog's league, found in the rows the grid already holds
  const openLeague = openId === null ? undefined : leaguesQuery.data?.find((league) => league.id === openId);

  return (
    <section className="space-y-6" data-testid="root-admin-customer-leagues-page">
      <PageHeader
        actions={<ExtendPreviewsButton />}
        tabs={<CustomersPageTabs active="leagues" />}
        testId="root-admin-customers-header"
        title="Customers"
      />
      <SectionCard padded testId="root-admin-customer-leagues" title="Leagues">
        <QueryState
          error={extractErrorMessage(leaguesQuery.error, { fallback: 'We could not load the leagues right now.' })}
          loading="Loading leagues..."
          query={leaguesQuery}
          testId="root-admin-customer-leagues-state"
        >
          {(leagues) => (
            <DataGrid
              columns={customerLeagueColumns}
              data={leagues}
              emptyMessage="No leagues."
              filterTestIdPrefix="root-admin-customer-leagues-filter"
              getRowId={(league) => league.id}
              openRowDialog={(league) => setOpenId(league.id)}
              rowTestId={(league) => `root-admin-customer-league-${league.id}`}
              tableTestId="root-admin-customer-leagues-table"
              urlKey="leagues"
            />
          )}
        </QueryState>
      </SectionCard>
      {openLeague ? <CustomerLeagueDialog key={openLeague.id} league={openLeague} onClose={() => setOpenId(null)} /> : null}
    </section>
  );
}

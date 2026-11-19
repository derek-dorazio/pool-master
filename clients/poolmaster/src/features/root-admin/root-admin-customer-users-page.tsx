import { useSearchParams } from 'react-router';
import { DataGrid, PageHeader, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { CustomerUserDialog } from './customer-user-dialog';
import { customerUserColumns } from './customer-user-columns';
import { CustomersPageTabs } from './customers-page-tabs';
import { CUSTOMER_USER_PARAM } from './manage-navigation';
import { useCustomerUsersQuery } from './use-customers-query';

/**
 * /manage/customers/users (#1883): every user on the platform in one grid, filtered from its
 * headers. A row's dialog is named in the address (?user=), so a link from elsewhere in Manage
 * opens it. Root admin, desktop only.
 */
export function RootAdminCustomerUsersPage() {
  const usersQuery = useCustomerUsersQuery();
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get(CUSTOMER_USER_PARAM);
  // poolmaster-allow-list-lookup: the dialog's user, found in the rows the grid already holds
  const openUser = openId === null ? undefined : usersQuery.data?.find((user) => user.id === openId);

  const setOpenId = (userId: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (userId === null) next.delete(CUSTOMER_USER_PARAM);
      else next.set(CUSTOMER_USER_PARAM, userId);
      return next;
    }, { replace: true });
  };

  return (
    <section className="space-y-6" data-testid="root-admin-customer-users-page">
      <PageHeader
        tabs={<CustomersPageTabs active="users" />}
        testId="root-admin-customers-header"
        title="Customers"
      />
      <SectionCard padded testId="root-admin-customer-users" title="Users">
        <QueryState
          error={extractErrorMessage(usersQuery.error, { fallback: 'We could not load the users right now.' })}
          loading="Loading users..."
          query={usersQuery}
          testId="root-admin-customer-users-state"
        >
          {(users) => (
            <DataGrid
              columns={customerUserColumns}
              data={users}
              emptyMessage="No users."
              filterTestIdPrefix="root-admin-customer-users-filter"
              getRowId={(user) => user.id}
              openRowDialog={(user) => setOpenId(user.id)}
              rowTestId={(user) => `root-admin-customer-user-${user.id}`}
              tableTestId="root-admin-customer-users-table"
              urlKey="users"
            />
          )}
        </QueryState>
      </SectionCard>
      {openUser ? <CustomerUserDialog key={openUser.id} onClose={() => setOpenId(null)} user={openUser} /> : null}
    </section>
  );
}

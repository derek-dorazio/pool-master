import { PageTabs } from '@/features/shared/ui';
import { CUSTOMER_LEAGUES_PATH, CUSTOMER_USERS_PATH } from './manage-navigation';

/** The Customers page's tabs (#1883): Leagues · Users. */
export function CustomersPageTabs({ active }: { active: 'leagues' | 'users' }) {
  return (
    <PageTabs
      aria-label="Customers views"
      items={[
        { isActive: active === 'leagues', label: 'Leagues', testId: 'root-admin-customers-tab-leagues', to: CUSTOMER_LEAGUES_PATH },
        { isActive: active === 'users', label: 'Users', testId: 'root-admin-customers-tab-users', to: CUSTOMER_USERS_PATH },
      ]}
      variant="link"
    />
  );
}

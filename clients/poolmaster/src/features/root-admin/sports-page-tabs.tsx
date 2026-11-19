import { PageTabs } from '@/features/shared/ui';
import { PROFILES_PATH, SPORTS_PATH } from './manage-navigation';

/** The Sports page's own tabs (the Sports page spec): Sport leagues · Profiles. */
export function SportsPageTabs({ active }: { active: 'leagues' | 'profiles' }) {
  return (
    <PageTabs
      aria-label="Sports views"
      items={[
        { isActive: active === 'leagues', label: 'Sport leagues', testId: 'root-admin-sports-tab-leagues', to: SPORTS_PATH },
        { isActive: active === 'profiles', label: 'Profiles', testId: 'root-admin-sports-tab-profiles', to: PROFILES_PATH },
      ]}
      variant="link"
    />
  );
}

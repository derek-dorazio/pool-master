import { PageHeader } from '@/features/shared/ui';
import { PricingProfilesSection } from './pricing-profiles-section';
import { SportsPageTabs } from './sports-page-tabs';
import { TierProfilesSection } from './tier-profiles-section';

/**
 * /manage/sports/profiles (#1849): the platform's tier and pricing profiles, each defined once;
 * every sport league names one of each. Root admin, desktop only.
 */
export function RootAdminProfilesPage() {
  return (
    <section className="space-y-6" data-testid="root-admin-profiles-page">
      <PageHeader tabs={<SportsPageTabs active="profiles" />} testId="root-admin-profiles-header" title="Sports" />
      <TierProfilesSection />
      <PricingProfilesSection />
    </section>
  );
}

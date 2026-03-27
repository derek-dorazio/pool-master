import { ConsentManager } from './consent-manager';
import { CCPAToggle } from './ccpa-toggle';
import { DataExportCard } from './data-export-card';
import { AccountDeletionCard } from './account-deletion-card';
import { CookiePreferencesCard } from './cookie-preferences';
import { SelfExclusionCard } from './self-exclusion-dialog';
import { SessionReminderCard } from './session-reminder-card';
import { ActivityLimitCard } from './activity-limit-card';

export function PrivacyPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Privacy & Data</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your data. Export your information, delete your account, and update consent
          preferences.
        </p>
      </div>

      <ConsentManager />

      <CCPAToggle />

      <CookiePreferencesCard />

      <DataExportCard />

      <h2 className="pt-4 text-xl font-semibold">Responsible Gaming</h2>

      <SelfExclusionCard />

      <SessionReminderCard />

      <ActivityLimitCard />

      <h2 className="pt-4 text-xl font-semibold">Danger Zone</h2>

      <AccountDeletionCard />
    </div>
  );
}

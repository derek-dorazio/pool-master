import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button, PageHeader, QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { EmailSettingsDialog } from './email-settings-dialog';
import { SystemEmailsSection } from './system-emails-section';
import { useSettingsGroupQuery } from './use-settings-groups';

/**
 * /manage/notifications (#1872): every system email in one grid, each opening its dialog (preview
 * its latest send, send yourself a copy, switch it on or off), and ⚙ Email settings for what every
 * email obeys. Root admin, desktop only.
 */
export function RootAdminNotificationsPage() {
  const groupQuery = useSettingsGroupQuery('EMAIL_CONFIG');
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <section className="space-y-6" data-testid="root-admin-notifications-page">
      <PageHeader
        actions={(
          <Button
            data-testid="root-admin-email-settings-open"
            disabled={!groupQuery.data}
            onClick={() => setSettingsOpen(true)}
            size="sm"
            variant="secondary"
          >
            <Settings aria-hidden size={14} />
            Email settings
          </Button>
        )}
        testId="root-admin-notifications-header"
        title="Notifications"
      />
      <QueryState
        error={extractErrorMessage(groupQuery.error, { fallback: 'We could not load the email settings right now.' })}
        loading="Loading email settings..."
        query={groupQuery}
        size="tile"
        testId="root-admin-notifications"
      >
        {(group) => (
          <>
            <SystemEmailsSection group={group} />
            {settingsOpen ? <EmailSettingsDialog group={group} onClose={() => setSettingsOpen(false)} /> : null}
          </>
        )}
      </QueryState>
    </section>
  );
}

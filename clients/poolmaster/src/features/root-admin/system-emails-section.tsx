import { useState } from 'react';
import type { EmailTemplateKey } from '@poolmaster/shared/domain';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import type { EmailSettingsGroup } from './use-email-settings-form';
import { systemEmailColumns } from './system-email-columns';
import { SystemEmailDialog } from './system-email-dialog';
import { useSystemEmailsQuery } from './use-system-emails';

/**
 * The Notifications page's Emails (#1872): one grid of every system email, each row's ⤢ opening
 * its dialog. The dialog follows the list, so a save or a send shows at once.
 */
export function SystemEmailsSection({ group }: { group: EmailSettingsGroup }) {
  const emailsQuery = useSystemEmailsQuery();
  const [openKey, setOpenKey] = useState<EmailTemplateKey | null>(null);
  // poolmaster-allow-list-lookup: one row per system email, a couple of dozen
  const openEmail = openKey === null ? undefined : emailsQuery.data?.find((email) => email.templateKey === openKey);

  return (
    <SectionCard padded testId="root-admin-system-emails" title="Emails">
      <QueryState
        error={extractErrorMessage(emailsQuery.error, { fallback: 'We could not load the system emails right now.' })}
        loading="Loading system emails..."
        query={emailsQuery}
        testId="root-admin-system-emails-state"
      >
        {(emails) => (
          <DataGrid
            columns={systemEmailColumns}
            data={emails}
            emptyMessage="No system emails."
            filterTestIdPrefix="root-admin-system-emails-filter"
            getRowId={(email) => email.templateKey}
            openRowDialog={(email) => setOpenKey(email.templateKey)}
            rowTestId={(email) => `root-admin-system-email-${email.templateKey}`}
            tableTestId="root-admin-system-emails-table"
            urlKey="emails"
          />
        )}
      </QueryState>
      {openEmail ? <SystemEmailDialog email={openEmail} group={group} key={openEmail.templateKey} onClose={() => setOpenKey(null)} /> : null}
    </SectionCard>
  );
}

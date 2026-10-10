import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listSettingsGroupHistory, listSettingsGroups, type SettingsGroup } from '@/lib/api';
import {
  AsyncPage,
  Button,
  DateDisplay,
  LinkButton,
  SettingsRow,
  SettingsSection,
  StatusBadge,
} from '@/features/shared/ui';
import { QueryKeys } from '@/lib/query-keys';
import { throwApiError, extractErrorMessage } from '@/lib/errors';
import { EmailSettingsForm } from './root-admin-email-settings-form';
import { ManagePageIntro } from './manage-page-intro';
import { SETTINGS_PATH } from './manage-navigation';
import {
  changedFields,
  summarizeEmail,
  summarizeIngestionSchedule,
  type SettingsSummaryItem,
} from './root-admin-settings-utils';

/**
 * /manage/settings (#450) — one settings section per group: what is in use, whether it is saved
 * or the defaults, who last changed it, and its recent changes. The ingestion schedule edits on
 * its own pages under Settings; Email is edited in its section.
 */
export function RootAdminSettingsPage() {
  const settingsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.settings,
    queryFn: async () => {
      const response = await listSettingsGroups();
      if (!response.data) {
        throwApiError(response.error, 'Settings response is missing data.');
      }
      return response.data.groups;
    },
    retry: false,
  });

  const pageState = settingsQuery.isError ? 'error' : settingsQuery.isLoading ? 'loading' : 'ready';

  return (
    <AsyncPage
      errorBody={extractErrorMessage(settingsQuery.error, { fallback: 'We could not load settings right now.' })}
      loadingBody="Loading settings..."
      state={pageState}
      testId="root-admin-settings-page"
    >
      <ManagePageIntro>
        How the app behaves, changeable without a deploy. A saved change reaches every server
        within 30 seconds.
      </ManagePageIntro>
      {settingsQuery.data?.map((group) => (
        <SettingsGroupSection group={group} key={group.key} />
      ))}
    </AsyncPage>
  );
}

function SettingsGroupSection({ group }: { group: SettingsGroup }) {
  const [showHistory, setShowHistory] = useState(false);
  const { summary, actions } = groupContent(group);

  return (
    <SettingsSection
      action={(
        <StatusBadge tone={group.source === 'stored' ? 'info' : 'neutral'}>
          {group.source === 'stored' ? 'Saved' : 'Defaults'}
        </StatusBadge>
      )}
      description={group.description}
      testId={`root-admin-settings-group-${group.key}`}
      title={group.title}
    >
      {summary.map((item) => (
        <SettingsRow key={item.id} label={item.label} value={item.value} />
      ))}
      <div className="space-y-5 px-5 py-4">
        {group.key === 'EMAIL_CONFIG' ? <EmailSettingsForm group={group} /> : null}
        <p className="text-sm text-muted-foreground" data-testid={`root-admin-settings-last-change-${group.key}`}>
          {group.updatedAt ? (
            <>
              Last changed by {group.updatedBy?.name ?? 'an unknown admin'} on <DateDisplay value={group.updatedAt} />
            </>
          ) : 'Never changed: using the defaults.'}
        </p>
        <div className="flex flex-wrap gap-3">
          {actions}
          <Button
            data-testid={`root-admin-settings-history-toggle-${group.key}`}
            onClick={() => setShowHistory((open) => !open)}
            type="button"
            variant="secondary"
          >
            {showHistory ? 'Hide recent changes' : 'Show recent changes'}
          </Button>
        </div>
        {showHistory ? <SettingsHistory groupKey={group.key} /> : null}
      </div>
    </SettingsSection>
  );
}

function groupContent(group: SettingsGroup): { summary: SettingsSummaryItem[]; actions: ReactNode } {
  switch (group.key) {
    case 'INGESTION_SCHEDULE_CONFIG':
      return {
        summary: summarizeIngestionSchedule(group.value),
        actions: (
          <>
            <LinkButton data-testid="root-admin-settings-edit-INGESTION_SCHEDULE_CONFIG" to={`${SETTINGS_PATH}/ingestion-schedule`}>
              Edit ingestion schedule
            </LinkButton>
            <LinkButton to={`${SETTINGS_PATH}/sport-overrides`} variant="secondary">
              Sport overrides
            </LinkButton>
          </>
        ),
      };
    case 'EMAIL_CONFIG':
      // Edited in place: the section carries the form.
      return { summary: summarizeEmail(group.value), actions: null };
  }
}

function SettingsHistory({ groupKey }: { groupKey: SettingsGroup['key'] }) {
  const historyQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.settingsHistory(groupKey),
    queryFn: async () => {
      const response = await listSettingsGroupHistory({ path: { key: groupKey } });
      if (!response.data) {
        throwApiError(response.error, 'Settings history response is missing data.');
      }
      return response.data.changes;
    },
    retry: false,
  });

  if (historyQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading recent changes...</p>;
  }
  if (historyQuery.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        {extractErrorMessage(historyQuery.error, { fallback: 'We could not load recent changes right now.' })}
      </p>
    );
  }
  if (!historyQuery.data?.length) {
    return <p className="text-sm text-muted-foreground">No changes have been saved yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm text-muted-foreground" data-testid={`root-admin-settings-history-${groupKey}`}>
      {historyQuery.data.map((change) => {
        const fields = changedFields(change);
        return (
          <li key={change.id}>
            <DateDisplay value={change.changedAt} /> by {change.changedBy?.name ?? 'an unknown admin'}
            {': '}
            {fields.length > 0 ? `changed ${fields.join(', ')}` : 'saved with no change'}
          </li>
        );
      })}
    </ul>
  );
}

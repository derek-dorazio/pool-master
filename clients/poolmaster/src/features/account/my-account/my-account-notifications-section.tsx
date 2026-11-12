import { useQueryClient } from '@tanstack/react-query';
import type { OptionalEmailCategory } from '@poolmaster/shared/domain';
import { updateUserEmailPreference } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { HelpTip, Notice, QueryState, SettingsRow, SettingsSection, Switch } from '@/features/shared/ui';
import { EMAIL_CATEGORY_LABELS, SELF_EMAIL_PREFERENCES_KEY, useOwnEmailPreferences } from '../email-preferences';
import { SELF_USER_ID } from '../user-routing';

type EmailPreferenceChange = { category: OptionalEmailCategory; enabled: boolean };

/**
 * My account › Email notifications: one switch per category, the same for every league. A flip
 * shows at once and saves straight away; the answer is the whole set of switches, written into
 * the cache. A refused save puts the switch back and says why.
 */
export function MyAccountNotificationsSection() {
  const logger = getLogger().child({ feature: 'my-account-notifications' });
  const queryClient = useQueryClient();
  const preferencesQuery = useOwnEmailPreferences();
  const mutation = useInvalidatingMutation({
    mutationFn: async (change: EmailPreferenceChange) => {
      const response = await updateUserEmailPreference({ path: { userId: SELF_USER_ID }, body: change });
      if (!response.data) {
        throwApiError(response.error, 'Email preference update response is missing data.');
      }
      return response.data;
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(SELF_EMAIL_PREFERENCES_KEY, preferences);
    },
    onError: (error) => {
      logger.warn({ action: 'emailPreferences.update.failed', err: error }, 'Email preference update failed');
    },
    // The answer is the whole set of switches, written into the cache above.
    invalidates: [],
  });
  const pending = mutation.isPending ? mutation.variables : undefined;

  return (
    <SettingsSection
      help="Invitations and account emails, such as password resets, are always sent."
      testId="my-account-notifications"
      title="Email notifications"
    >
      {mutation.isError ? (
        <div className="px-4 py-3">
          <Notice data-testid="my-account-notifications-save-error" tone="danger">
            {extractErrorMessage(mutation.error, { fallback: 'We could not save that change.' })}
          </Notice>
        </div>
      ) : null}
      <QueryState
        error={extractErrorMessage(preferencesQuery.error, { fallback: 'We could not load your email settings.' })}
        loading="Loading your email settings..."
        query={preferencesQuery}
        rows={5}
        testId="my-account-notifications"
      >
        {(data) => data.preferences.map(({ category, enabled }) => {
          const { label, description } = EMAIL_CATEGORY_LABELS[category];
          const checked = pending?.category === category ? pending.enabled : enabled;
          return (
            <SettingsRow
              action={(
                <Switch
                  checked={checked}
                  disabled={mutation.isPending}
                  label={label}
                  onCheckedChange={(next) => mutation.mutate({ category, enabled: next })}
                  testId={`my-account-notifications-${category}`}
                />
              )}
              key={category}
              label={(
                <>
                  {label}
                  <HelpTip label={`About ${label}`} testId={`my-account-notifications-${category}-help`}>
                    {description}
                  </HelpTip>
                </>
              )}
              testId={`my-account-notifications-row-${category}`}
            />
          );
        })}
      </QueryState>
    </SettingsSection>
  );
}

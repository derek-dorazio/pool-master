import { useQueryClient } from '@tanstack/react-query';
import type { EmailSuppressionReason, OptionalEmailCategory } from '@poolmaster/shared/domain';
import { updateUserEmailPreference } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { Checkbox, ErrorState, Modal, Notice, SectionCard, SectionRow, SectionRows, Text } from '@/features/shared/ui';
import { EMAIL_CATEGORY_LABELS, SELF_EMAIL_PREFERENCES_KEY, useOwnEmailPreferences } from './email-preferences';
import { SELF_USER_ID } from './user-routing';

const SUPPRESSION_MESSAGES: Record<EmailSuppressionReason, string> = {
  BOUNCE: 'Email to your address bounced, so we have stopped emailing you. Change your email in Edit profile to start again.',
  COMPLAINT: 'An email from us was marked as spam, so we have stopped emailing you. Change your email in Edit profile to start again.',
};

/** Says why no email reaches the member at all, when their address bounced or complained. */
export function EmailSuppressionBanner({ reason }: { reason: EmailSuppressionReason | null | undefined }) {
  if (!reason) {
    return null;
  }
  return (
    <Notice data-testid="email-suppression-banner" title="We can't email you" tone="warning">
      <Text as="p" className="mt-1">{SUPPRESSION_MESSAGES[reason]}</Text>
    </Notice>
  );
}

export function EmailNotificationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const logger = getLogger().child({ feature: 'email-notifications' });
  const queryClient = useQueryClient();
  const preferencesQuery = useOwnEmailPreferences(open);
  const updateMutation = useInvalidatingMutation({
    mutationFn: async (change: { category: OptionalEmailCategory; enabled: boolean }) => {
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

  return (
    <Modal
      closeLabel="Close Email notifications"
      description="Choose which emails you get from your leagues. Invitations and account emails, such as password resets, are always sent."
      descriptionId="email-notifications-dialog-description"
      onOpenChange={onOpenChange}
      open={open}
      testId="email-notifications-dialog"
      title="Email notifications"
    >
      <div className="space-y-4">
        <EmailSuppressionBanner reason={preferencesQuery.data?.emailSuppression} />
        {preferencesQuery.isError ? (
          <ErrorState
            body={extractErrorMessage(preferencesQuery.error, { fallback: 'We could not load your email settings.' })}
            onRetry={() => void preferencesQuery.refetch()}
            testId="email-notifications-load-error"
          />
        ) : null}
        {updateMutation.isError ? (
          <Notice tone="danger">{extractErrorMessage(updateMutation.error, { fallback: 'We could not save that change.' })}</Notice>
        ) : null}
        {preferencesQuery.data ? (
          <SectionCard testId="email-notifications-list" title="League emails">
            <SectionRows>
              {preferencesQuery.data.preferences.map(({ category, enabled }) => (
                <SectionRow
                  control={(
                    <Checkbox
                      checked={enabled}
                      data-testid={`email-notifications-${category}`}
                      disabled={updateMutation.isPending}
                      onChange={(event) => updateMutation.mutate({ category, enabled: event.target.checked })}
                    />
                  )}
                  facts={EMAIL_CATEGORY_LABELS[category].description}
                  key={category}
                  name={EMAIL_CATEGORY_LABELS[category].label}
                  testId={`email-notifications-row-${category}`}
                />
              ))}
            </SectionRows>
          </SectionCard>
        ) : null}
      </div>
    </Modal>
  );
}

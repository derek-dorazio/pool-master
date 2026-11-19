import { useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { Button, DateDisplay, DetailEditModal, showToast, type Fact } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { EmailSettingsFields } from './email-settings-fields';
import { emailSettingsFormValues, useEmailSettingsForm, type EmailSettingsGroup } from './use-email-settings-form';
import { emailSendResultToast } from './email-send-result';
import { summarizeEmail } from './root-admin-settings-utils';
import { useCheckDelivery } from './use-system-emails';

const TEST_ID = 'root-admin-email-settings-dialog';
const CHECK_DELIVERY = 'Check delivery';

/**
 * The ⚙ Email settings dialog (#1872), on the shared `DetailEditModal`: the settings every system
 * email obeys and who last changed them, with Check delivery (the test email, to the admin's own
 * address, through the saved settings) between Close and Edit; Edit turns it into the settings'
 * form with Cancel and Save.
 */
export function EmailSettingsDialog({ group, onClose }: { group: EmailSettingsGroup; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const settings = useEmailSettingsForm(group);
  const checkDelivery = useCheckDelivery();
  const { user } = useAuth();

  const cancelEdit = () => {
    settings.saveMutation.reset();
    setMode('view');
  };
  const dismiss = mode === 'edit' ? cancelEdit : onClose;
  const facts: Fact[] = [
    ...summarizeEmail(group.value).map((item) => ({ ...item, testId: `${TEST_ID}-${item.id}` })),
    {
      id: 'last-changed',
      label: 'Last changed by',
      testId: `${TEST_ID}-last-changed`,
      value: group.updatedAt
        ? <>{group.updatedBy?.name ?? 'An unknown admin'} on <DateDisplay value={group.updatedAt} /></>
        : 'Never changed: using the defaults',
    },
  ];

  return (
    <DetailEditModal
      facts={facts}
      isPending={settings.saveMutation.isPending}
      mode={mode}
      onCancel={dismiss}
      onCancelEdit={cancelEdit}
      onEdit={() => {
        settings.saveMutation.reset();
        settings.form.reset(emailSettingsFormValues(group));
        setMode('edit');
      }}
      onOpenChange={(isOpen) => {
        if (!isOpen) dismiss();
      }}
      onSave={() => void settings.form.handleSubmit((values) => settings.saveMutation.mutate(values, { onSuccess: () => setMode('view') }))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      saveTestId="root-admin-email-settings-save"
      testId={TEST_ID}
      title={mode === 'edit' ? 'Email settings · Edit' : 'Email settings'}
      viewActions={user ? (
        <Button
          data-testid={`${TEST_ID}-check-delivery`}
          disabled={checkDelivery.isPending}
          onClick={() => checkDelivery.mutate(user.email, {
            onSuccess: (result) => showToast(emailSendResultToast(CHECK_DELIVERY, result)),
            onError: (error) => showToast({
              title: CHECK_DELIVERY,
              description: extractErrorMessage(error, { fallback: 'We could not send the test email.' }),
              tone: 'danger',
            }),
          })}
          type="button"
          variant="secondary"
        >
          {checkDelivery.isPending ? 'Sending...' : CHECK_DELIVERY}
        </Button>
      ) : null}
    >
      <EmailSettingsFields settings={settings} />
    </DetailEditModal>
  );
}

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { EmailTemplateStatus, type EmailTemplateKey } from '@poolmaster/shared/domain';
import { Button, Checkbox, DetailEditModal, Notice, showToast, Text, type Fact } from '@/features/shared/ui';
import type { EmailConfig, SystemEmailDto } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { emailSendResultToast } from './email-send-result';
import type { EmailSettingsGroup } from './use-email-settings-form';
import { SettingsSaveError } from './settings-save-error';
import { EmailStatusChip } from './email-status-chip';
import { EMAIL_AUDIENCE_LABELS, planText, SYSTEM_EMAIL_LABELS } from './system-email-labels';
import { SystemEmailPreviewDialog } from './system-email-preview-dialog';
import { useSendLatestToMe } from './use-system-emails';
import { useSettingsGroupForm } from './use-settings-group-form';

type SwitchableKey = keyof EmailConfig['templates'];

/** Whether the email has its own switch in the email settings; account emails and the test email have none. */
function isSwitchable(templateKey: EmailTemplateKey, templates: EmailConfig['templates']): templateKey is SwitchableKey {
  return Object.hasOwn(templates, templateKey);
}

const StatusFormSchema = z.object({ on: z.boolean() });
type StatusFormValues = z.infer<typeof StatusFormSchema>;

const TEST_ID = 'root-admin-system-email-dialog';
const SEND_TO_ME = 'Send me this email';

/**
 * One system email's dialog (#1872), on the shared `DetailEditModal`: who gets it, when, its plan,
 * status and sends, with Preview and Send me this email between Close and Edit, both disabled
 * until a send keeps its content. Edit changes its status only, through its switch in the email
 * settings; an email with no switch (Always on) has no Edit. Preview opens the latest send in a
 * dialog of its own, and closing it comes back here.
 */
export function SystemEmailDialog({ email, group, onClose }: { email: SystemEmailDto; group: EmailSettingsGroup; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [previewing, setPreviewing] = useState(false);
  const { templateKey } = email;
  const label = SYSTEM_EMAIL_LABELS[templateKey];
  const switchKey = isSwitchable(templateKey, group.value.templates) ? templateKey : null;
  const toForm = (value: EmailConfig): StatusFormValues => ({ on: switchKey === null ? true : value.templates[switchKey] });
  const settings = useSettingsGroupForm({
    group,
    resolver: zodResolver(StatusFormSchema),
    subject: 'Email settings',
    toForm,
    toValue: (values: StatusFormValues): EmailConfig => (switchKey === null
      ? group.value
      : { ...group.value, templates: { ...group.value.templates, [switchKey]: values.on } }),
  });
  const sendToMe = useSendLatestToMe();

  if (previewing) {
    return <SystemEmailPreviewDialog email={email} onClose={() => setPreviewing(false)} />;
  }

  const hasPreview = email.previewSentAt !== null;
  const canEdit = switchKey !== null && email.status !== EmailTemplateStatus.ALWAYS_ON;
  const cancelEdit = () => {
    settings.saveMutation.reset();
    setMode('view');
  };
  const dismiss = mode === 'edit' ? cancelEdit : onClose;
  const facts: Fact[] = [
    { id: 'audience', label: 'Audience', value: EMAIL_AUDIENCE_LABELS[label.audience], testId: `${TEST_ID}-audience` },
    { id: 'when', label: 'When', value: label.when, testId: `${TEST_ID}-when` },
    { id: 'plan', label: 'Plan', value: planText(email.planStartsAt), testId: `${TEST_ID}-plan` },
    { id: 'status', label: 'Status', value: <EmailStatusChip status={email.status} />, testId: `${TEST_ID}-status` },
    { id: 'sent', label: 'Sent (30 days)', value: email.sentLast30Days, testId: `${TEST_ID}-sent` },
    ...(hasPreview ? [] : [{
      id: 'preview',
      label: 'Preview',
      value: email.lastSentAt === null ? 'Not sent yet' : 'None kept from the last 30 days',
      testId: `${TEST_ID}-not-sent`,
    }]),
  ];

  return (
    <DetailEditModal
      facts={facts}
      isPending={settings.saveMutation.isPending}
      mode={mode}
      onCancel={dismiss}
      onCancelEdit={cancelEdit}
      onEdit={canEdit
        ? () => {
          settings.saveMutation.reset();
          settings.form.reset(toForm(group.value));
          setMode('edit');
        }
        : undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) dismiss();
      }}
      onSave={() => void settings.form.handleSubmit((values) => settings.saveMutation.mutate(values, { onSuccess: () => setMode('view') }))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      testId={TEST_ID}
      title={mode === 'edit' ? `${label.name} · Edit` : label.name}
      viewActions={(
        <>
          <Button data-testid={`${TEST_ID}-preview`} disabled={!hasPreview} onClick={() => setPreviewing(true)} type="button" variant="secondary">
            Preview
          </Button>
          <Button
            data-testid={`${TEST_ID}-send-to-me`}
            disabled={!hasPreview || sendToMe.isPending}
            onClick={() => sendToMe.mutate(templateKey, {
              onSuccess: (result) => showToast(emailSendResultToast(SEND_TO_ME, result)),
              onError: (error) => showToast({
                title: SEND_TO_ME,
                description: extractErrorMessage(error, { fallback: 'We could not send you this email.' }),
                tone: 'danger',
              }),
            })}
            type="button"
            variant="secondary"
          >
            {sendToMe.isPending ? 'Sending...' : SEND_TO_ME}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {group.value.enabled ? null : (
          <Notice data-testid={`${TEST_ID}-email-off`} tone="warning">
            &quot;Send system email&quot; is off in Email settings, so no email is sent whatever its status.
          </Notice>
        )}
        <label className="flex items-center gap-2">
          <Checkbox data-testid={`${TEST_ID}-status-on`} {...settings.form.register('on')} />
          <Text>On: send this email</Text>
        </label>
        <SettingsSaveError
          conflicted={settings.conflicted}
          error={settings.saveMutation.error}
          fallback="We could not save this email's status."
          onLoadLatest={settings.loadLatest}
          testId={`${TEST_ID}-error`}
        />
      </div>
    </DetailEditModal>
  );
}

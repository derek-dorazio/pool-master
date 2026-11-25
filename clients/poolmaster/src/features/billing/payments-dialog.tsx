import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DateDisplay, DetailEditModal, FormField, HelpTip, Select, showToast } from '@/features/shared/ui';
import { SettingsSaveError } from '@/features/root-admin/settings-save-error';
import { useSettingsGroupDialog } from '@/features/root-admin/use-settings-group-dialog';
import { useSettingsGroupForm } from '@/features/root-admin/use-settings-group-form';
import type { BillingSettingsGroup } from './billing-settings-group';

const PaymentsFormSchema = z.object({ payments: z.enum(['on', 'off']) });
type PaymentsForm = z.infer<typeof PaymentsFormSchema>;

/**
 * The Pricing page's ⚙ Payments (#1886): whether payments are on and who last changed the payments
 * settings, with Close and Edit; Edit switches payments on or off and saves the whole settings
 * with only that changed, against the version it read (rules/ux-rules.md §12 item 14); when
 * someone else saved first it offers to load theirs.
 */
export function PaymentsDialog({ group, onClose }: { group: BillingSettingsGroup; onClose: () => void }) {
  const testId = 'root-admin-payments-dialog';
  const toForm = (value: BillingSettingsGroup['value']): PaymentsForm => ({ payments: value.paymentsEnabled ? 'on' : 'off' });
  const settings = useSettingsGroupForm<BillingSettingsGroup, PaymentsForm>({
    group,
    resolver: zodResolver(PaymentsFormSchema),
    subject: 'Payments settings',
    toForm,
    toValue: (values) => ({ ...group.value, paymentsEnabled: values.payments === 'on' }),
  });
  const { conflicted, form, loadLatest, saveMutation } = settings;
  const { mode, modalProps } = useSettingsGroupDialog({
    group,
    onClose,
    onSaved: (saved) => showToast({ title: saved.value.paymentsEnabled ? 'Payments are on' : 'Payments are off', tone: 'success' }),
    settings,
    testId,
    toForm,
  });

  return (
    <DetailEditModal
      {...modalProps}
      facts={[
        { id: 'payments', label: 'Payments', value: group.value.paymentsEnabled ? 'On' : 'Off', testId: `${testId}-payments` },
        {
          id: 'last-changed',
          label: 'Last changed by',
          value: group.updatedAt === null
            ? 'Never: on the defaults'
            : <>{group.updatedBy?.name ?? 'an unknown admin'} on <DateDisplay timeStyle={null} value={group.updatedAt} /></>,
          testId: `${testId}-last-changed`,
        },
      ]}
      title={(
        <span className="inline-flex items-center gap-2">
          {mode === 'view' ? 'Payments' : 'Payments · Edit'}
          <HelpTip label="About payments" testId={`${testId}-help`}>
            Off: commissioners expand contests free and nothing is charged. On: expanding needs
            checkout, which is not built yet, so expansions are refused until it is.
          </HelpTip>
        </span>
      )}
    >
      <div className="grid gap-4">
        <FormField label="Payments">
          <Select data-testid={`${testId}-payments-input`} {...form.register('payments')}>
            <option value="off">Off</option>
            <option value="on">On</option>
          </Select>
        </FormField>
        <SettingsSaveError
          conflicted={conflicted}
          error={saveMutation.error}
          fallback="We could not save the payments setting."
          loadLabel="Load the latest settings"
          onLoadLatest={loadLatest}
          testId={`${testId}-error`}
        />
      </div>
    </DetailEditModal>
  );
}

import { useState } from 'react';
import { DateDisplay, DetailEditModal, FormField, HelpTip, Select, showToast } from '@/features/shared/ui';
import { useSaveBillingConfig, type BillingSettingsGroup } from './use-save-billing-config';

type PaymentsChoice = 'on' | 'off';

/**
 * The Pricing page's ⚙ Payments (#1886): whether payments are on and who last changed the payments
 * settings, with Close and Edit; Edit switches payments on or off and saves the whole settings
 * with only that changed (rules/ux-rules.md §12 item 14).
 */
export function PaymentsDialog({ group, onClose }: { group: BillingSettingsGroup; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const current: PaymentsChoice = group.value.paymentsEnabled ? 'on' : 'off';
  const [choice, setChoice] = useState<PaymentsChoice>(current);
  // The version Edit started from, so a save over a newer one is refused, not lost.
  const [editedGroup, setEditedGroup] = useState(group);
  const testId = 'root-admin-payments-dialog';

  const saveMutation = useSaveBillingConfig({
    onSaved: (saved) => {
      showToast({ title: saved.value.paymentsEnabled ? 'Payments are on' : 'Payments are off', tone: 'success' });
      setMode('view');
    },
  });

  return (
    <DetailEditModal
      canSave={choice !== (editedGroup.value.paymentsEnabled ? 'on' : 'off')}
      error={saveMutation.error}
      errorFallback="We could not save the payments setting."
      facts={[
        { id: 'payments', label: 'Payments', value: current === 'on' ? 'On' : 'Off', testId: `${testId}-payments` },
        {
          id: 'last-changed',
          label: 'Last changed by',
          value: group.updatedAt === null
            ? 'Never: on the defaults'
            : <>{group.updatedBy?.name ?? 'an unknown admin'} on <DateDisplay timeStyle={null} value={group.updatedAt} /></>,
          testId: `${testId}-last-changed`,
        },
      ]}
      isPending={saveMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={() => {
        saveMutation.reset();
        setMode('view');
      }}
      onEdit={() => {
        setEditedGroup(group);
        setChoice(current);
        saveMutation.reset();
        setMode('edit');
      }}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => saveMutation.mutate({
        value: { ...editedGroup.value, paymentsEnabled: choice === 'on' },
        expectedUpdatedAt: editedGroup.updatedAt,
      })}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      testId={testId}
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
      <FormField label="Payments">
        <Select
          data-testid={`${testId}-payments-input`}
          onChange={(event) => setChoice(event.target.value === 'on' ? 'on' : 'off')}
          value={choice}
        >
          <option value="off">Off</option>
          <option value="on">On</option>
        </Select>
      </FormField>
    </DetailEditModal>
  );
}

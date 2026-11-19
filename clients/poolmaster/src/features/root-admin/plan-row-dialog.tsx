import { useState, type ReactNode } from 'react';
import type { DefaultValues, FieldValues, Resolver, UseFormReturn } from 'react-hook-form';
import type { SettingsGroup } from '@/lib/api';
import { DetailEditModal, type Fact } from '@/features/shared/ui';
import { SettingsSaveError } from './settings-save-error';
import { useSettingsGroupForm } from './use-settings-group-form';

export type PlanSettingsGroup = Extract<SettingsGroup, { key: 'PLAN_CONFIG' }>;

/**
 * One Plans grid row's dialog (#1884): the row's facts with Close and Edit, then its form with
 * Cancel and Save, back to the view (rules/ux-rules.md §12 item 14). Save sends the whole
 * PLAN_CONFIG record with only this row changed, against the version it read; when someone else
 * saved first it offers to load theirs.
 */
export function PlanRowDialog<V extends FieldValues>({
  children,
  facts,
  group,
  name,
  onClose,
  resolver,
  testId,
  toForm,
  toValue,
}: {
  children: (form: UseFormReturn<V>) => ReactNode;
  facts: Fact[];
  group: PlanSettingsGroup;
  /** The cap or feature, as the dialog's title. */
  name: string;
  onClose: () => void;
  resolver: Resolver<V>;
  testId: string;
  /** This row's form values, from a PLAN_CONFIG record. */
  toForm: (config: PlanSettingsGroup['value']) => DefaultValues<V>;
  /** The whole record with this row's values put in. */
  toValue: (values: V) => PlanSettingsGroup['value'];
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const { conflicted, form, loadLatest, saveMutation } = useSettingsGroupForm<PlanSettingsGroup, V>({
    group,
    resolver,
    subject: 'Plans settings',
    toForm,
    toValue,
  });

  return (
    <DetailEditModal
      canSave={form.formState.isDirty}
      facts={facts}
      isPending={saveMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={() => {
        saveMutation.reset();
        setMode('view');
      }}
      onEdit={() => {
        form.reset(toForm(group.value));
        setMode('edit');
      }}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void form.handleSubmit((values) => saveMutation.mutate(values, { onSuccess: () => setMode('view') }))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      testId={testId}
      title={mode === 'view' ? name : `${name} · Edit`}
    >
      <div className="grid gap-4">
        {children(form)}
        <SettingsSaveError
          conflicted={conflicted}
          error={saveMutation.error}
          fallback="We could not save the plans."
          loadLabel="Load the latest plans"
          onLoadLatest={loadLatest}
          testId={`${testId}-error`}
        />
      </div>
    </DetailEditModal>
  );
}

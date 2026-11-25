import type { ReactNode } from 'react';
import type { DefaultValues, FieldValues, Resolver, UseFormReturn } from 'react-hook-form';
import type { SettingsGroup } from '@/lib/api';
import { DetailEditModal, type Fact } from '@/features/shared/ui';
import { SettingsSaveError } from './settings-save-error';
import { useSettingsGroupDialog } from './use-settings-group-dialog';
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
  const settings = useSettingsGroupForm<PlanSettingsGroup, V>({
    group,
    resolver,
    subject: 'Plans settings',
    toForm,
    toValue,
  });
  const { conflicted, form, loadLatest, saveMutation } = settings;
  const { mode, modalProps } = useSettingsGroupDialog({ group, onClose, settings, testId, toForm });

  return (
    <DetailEditModal
      {...modalProps}
      facts={facts}
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

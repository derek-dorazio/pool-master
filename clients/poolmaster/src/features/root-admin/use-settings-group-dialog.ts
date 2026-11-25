import { useState } from 'react';
import type { DefaultValues, FieldValues } from 'react-hook-form';
import type { SettingsGroup } from '@/lib/api';
import type { useSettingsGroupForm } from './use-settings-group-form';

type SettingsGroupForm<G extends SettingsGroup, V extends FieldValues> = ReturnType<typeof useSettingsGroupForm<G, V>>;

/**
 * A settings dialog's view-then-edit plumbing (rules/ux-rules.md §12 item 14), for a dialog
 * opened from outside that edits one settings group through `useSettingsGroupForm`: it opens on
 * the facts; Edit starts the draft from the group and clears a past save; Cancel goes back to
 * the facts; Save goes back to them once saved, after `onSaved`. Spread `modalProps` on
 * `DetailEditModal` and give it the facts, title and form.
 */
export function useSettingsGroupDialog<G extends SettingsGroup, V extends FieldValues>({
  group,
  onClose,
  onSaved,
  settings,
  testId,
  toForm,
}: {
  group: G;
  onClose: () => void;
  /** Hears each saved version, before the dialog goes back to the facts. */
  onSaved?: (saved: G) => void;
  settings: SettingsGroupForm<G, V>;
  testId: string;
  toForm: (value: G['value']) => DefaultValues<V>;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const { form, saveMutation } = settings;

  return {
    mode,
    modalProps: {
      canSave: form.formState.isDirty,
      isPending: saveMutation.isPending,
      mode,
      onCancel: onClose,
      onCancelEdit: () => {
        saveMutation.reset();
        setMode('view');
      },
      onEdit: () => {
        form.reset(toForm(group.value));
        saveMutation.reset();
        setMode('edit');
      },
      // Opened from outside, so the one change the dialog reports is a close.
      onOpenChange: onClose,
      onSave: () => void form.handleSubmit((values) => saveMutation.mutate(values, {
        onSuccess: (saved) => {
          onSaved?.(saved);
          setMode('view');
        },
      }))(),
      open: true,
      pendingLabel: 'Saving...',
      saveLabel: 'Save',
      testId,
    },
  };
}

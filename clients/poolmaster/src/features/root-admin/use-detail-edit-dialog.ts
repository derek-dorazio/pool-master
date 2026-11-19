import { useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

type SaveMutation<TValues> = {
  error: Error | null;
  isPending: boolean;
  mutate: (values: TValues) => void;
  reset: () => void;
};

/**
 * A Manage dialog's view-then-edit flow over one form (rules/ux-rules.md §12 item 14): it opens
 * in view mode, Edit swaps in the form, Cancel puts the values back, and a save returns to view
 * with the saved values as the new baseline. `modalProps` are `DetailEditModal`'s props for it.
 */
export function useDetailEditDialog<TValues extends FieldValues>(form: UseFormReturn<TValues>, current: TValues, onClose: () => void) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  /** After a save: the saved values are the new baseline, so Edit again with no change leaves Save off. */
  const saved = () => {
    form.reset(form.getValues());
    setMode('view');
  };

  const modalProps = (mutation: SaveMutation<TValues>) => ({
    error: mutation.error,
    isPending: mutation.isPending,
    mode,
    onCancel: onClose,
    onCancelEdit: () => {
      form.reset(current);
      mutation.reset();
      setMode('view');
    },
    onEdit: () => setMode('edit'),
    onOpenChange: (open: boolean) => (open ? undefined : onClose()),
    onSave: () => void form.handleSubmit((values) => mutation.mutate(values))(),
    open: true,
    pendingLabel: 'Saving...',
  });

  return { mode, modalProps, saved };
}

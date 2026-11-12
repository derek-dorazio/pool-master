import { useState } from 'react';
import type { DefaultValues, FieldValues, UseFormReturn } from 'react-hook-form';

type SectionMutation<TValues> = {
  isPending: boolean;
  mutateAsync: (values: TValues) => Promise<unknown>;
  reset: () => void;
};

/**
 * A settings section's Edit dialog: Edit opens it on the values as they stand with the last
 * failure cleared, Save validates and sends, and Cancel, Escape or a successful save (`close`)
 * shut it. Returns the `FormModal` props the sections share.
 */
export function useSectionDialog<TValues extends FieldValues>({
  form,
  mutation,
  valuesNow,
}: {
  form: UseFormReturn<TValues>;
  mutation: SectionMutation<TValues>;
  valuesNow: () => DefaultValues<TValues>;
}) {
  const [open, setOpen] = useState(false);
  const openDialog = () => {
    form.reset(valuesNow());
    mutation.reset();
    setOpen(true);
  };
  const close = () => setOpen(false);
  return {
    close,
    openDialog,
    modalProps: {
      isPending: mutation.isPending,
      onCancel: close,
      onOpenChange: (next: boolean) => (next ? openDialog() : close()),
      onSave: () => void form.handleSubmit((values) => mutation.mutateAsync(values).catch(() => undefined))(),
      open,
      pendingLabel: 'Saving...',
    },
  };
}

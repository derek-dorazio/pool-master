import type { ReactNode } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { FormModal, type MutationActionWorkflowResult } from '@/features/shared/ui';

/**
 * A tier or pricing profile's form dialog (#1849): Cancel and Save, a failed save's reason inside
 * it, and the dialog kept open on a refusal. Cancel forgets a failed attempt, so the next opening
 * starts clean.
 */
export function ProfileFormModal<TValues extends FieldValues, TSaved>({
  children,
  errorFallback,
  form,
  onCancel,
  save,
  testId,
  title,
}: {
  children: ReactNode;
  errorFallback: string;
  form: UseFormReturn<TValues>;
  onCancel: () => void;
  save: MutationActionWorkflowResult<TSaved, TValues>;
  testId: string;
  title: string;
}) {
  const cancel = () => {
    save.reset();
    onCancel();
  };
  return (
    <FormModal
      error={save.error}
      errorFallback={errorFallback}
      isPending={save.isPending}
      onCancel={cancel}
      onOpenChange={(isOpen) => {
        if (!isOpen) cancel();
      }}
      // A failed save shows its reason in the dialog, so the rejection is already handled.
      onSave={() => void form.handleSubmit((values) => save.run(values).catch(() => undefined))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      testId={testId}
      title={title}
    >
      {children}
    </FormModal>
  );
}

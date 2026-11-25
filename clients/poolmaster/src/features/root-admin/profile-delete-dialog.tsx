import type { QueryKey } from '@tanstack/react-query';
import { ConfirmDialog, useMutationActionWorkflow } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';

/**
 * Deletes a tier or pricing profile after a yes (#1849). The server refuses a profile any sport
 * league names and says how many do; that reason shows in the dialog, which stays open.
 */
export function ProfileDeleteDialog({
  invalidates,
  kindLabel,
  name,
  onClose,
  remove,
  testId,
}: {
  invalidates: QueryKey;
  /** As a sentence names it: "tier profile". */
  kindLabel: string;
  name: string;
  onClose: () => void;
  remove: () => Promise<void>;
  testId: string;
}) {
  const deletion = useMutationActionWorkflow({
    action: remove,
    invalidateQueries: [invalidates],
    onClose,
    successToast: { title: `Deleted ${name}`, tone: 'success' },
  });
  const cancel = () => {
    deletion.reset();
    onClose();
  };

  return (
    <ConfirmDialog
      confirmLabel="Delete"
      error={deletion.error ? extractErrorMessage(deletion.error, { fallback: `We could not delete the ${kindLabel}.` }) : undefined}
      isPending={deletion.isPending}
      onCancel={cancel}
      // A refusal shows its reason in the dialog, so the rejection is already handled.
      onConfirm={() => void deletion.run().catch(() => undefined)}
      // Opened from outside, so the one change the dialog reports is a close.
      onOpenChange={cancel}
      open
      pendingLabel="Deleting..."
      testId={testId}
      title={`Delete ${name}?`}
      tone="danger"
    />
  );
}

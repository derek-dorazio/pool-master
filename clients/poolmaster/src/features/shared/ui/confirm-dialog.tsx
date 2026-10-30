import type { ReactNode } from "react";
import { DialogActions } from "./dialog-actions";
import { Modal } from "./modal";

type ConfirmDialogProps = {
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmTestId?: string;
  description: ReactNode;
  isConfirmDisabled?: boolean;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pendingLabel?: string;
  testId?: string;
  title: ReactNode;
  tone?: "default" | "danger";
};

export function ConfirmDialog({
  cancelLabel = "Cancel",
  children,
  confirmLabel,
  confirmTestId,
  description,
  isConfirmDisabled = false,
  isPending = false,
  onCancel,
  onConfirm,
  onOpenChange,
  open,
  pendingLabel,
  testId,
  title,
  tone = "default",
}: ConfirmDialogProps) {
  return (
    <Modal
      description={description}
      footer={(
        <DialogActions
          actionLabel={confirmLabel}
          actionTestId={confirmTestId ?? (testId ? `${testId}-confirm` : undefined)}
          cancelLabel={cancelLabel}
          isActionDisabled={isConfirmDisabled}
          isPending={isPending}
          onAction={onConfirm}
          onCancel={onCancel}
          pendingLabel={pendingLabel}
          tone={tone}
        />
      )}
      isCloseDisabled={isPending}
      onClose={onCancel}
      onOpenChange={onOpenChange}
      open={open}
      size="sm"
      testId={testId}
      title={title}
    >
      {children}
    </Modal>
  );
}

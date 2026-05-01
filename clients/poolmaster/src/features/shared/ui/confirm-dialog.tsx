import type { ReactNode } from "react";
import { Button } from "./button";
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
  const visibleConfirmLabel = isPending && pendingLabel ? pendingLabel : confirmLabel;

  return (
    <Modal
      description={description}
      footer={
        <>
          <Button
            disabled={isPending}
            onClick={onCancel}
            type="button"
            variant="secondary"
          >
            {cancelLabel}
          </Button>
          <Button
            data-testid={confirmTestId ?? (testId ? `${testId}-confirm` : undefined)}
            disabled={isConfirmDisabled || isPending}
            onClick={onConfirm}
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
          >
            {visibleConfirmLabel}
          </Button>
        </>
      }
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

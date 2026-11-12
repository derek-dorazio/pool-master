import type { ReactNode } from "react";
import { DialogActions } from "./dialog-actions";
import { FormField, Input } from "./form-field";
import { Modal } from "./modal";
import { Notice } from "./notice";

/** A box the person must type a value into before a destructive action unlocks. */
export type ConfirmationInput = {
  expectedValue: string;
  helperText?: ReactNode;
  label: string;
  onChange: (value: string) => void;
  testId?: string;
  value: string;
};

export type ConfirmDialogProps = {
  cancelLabel?: string;
  children?: ReactNode;
  /** The close button's accessible name; "Close <title>" when left out and the title is text. */
  closeLabel?: string;
  confirmLabel: string;
  confirmTestId?: string;
  /** Type-to-confirm: the action stays disabled until `value` matches `expectedValue`. */
  confirmationInput?: ConfirmationInput;
  /** Only when it says what will happen ("Sam Lee will no longer be an owner of Incubus"). */
  description?: ReactNode;
  /** Why the last attempt failed: a red Notice above the buttons, and the dialog stays open. */
  error?: ReactNode;
  isConfirmDisabled?: boolean;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pendingLabel?: string;
  testId?: string;
  title: ReactNode;
  /** `danger` for an action that destroys, removes or cannot be undone. */
  tone?: "default" | "danger";
};

/**
 * The one yes/no dialog: Cancel and one action, `danger` toned for destructive ones, with an
 * optional type-to-confirm box. A failure shows inside it and keeps it open; a success closes it
 * and the caller confirms with a toast (rules/ux-rules.md §3 *Dialogs and save feedback*).
 */
export function ConfirmDialog({
  cancelLabel = "Cancel",
  children,
  closeLabel,
  confirmLabel,
  confirmTestId,
  confirmationInput,
  description,
  error,
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
  const confirmationMatches = confirmationInput
    ? confirmationInput.value === confirmationInput.expectedValue
    : true;

  return (
    <Modal
      closeLabel={closeLabel ?? (typeof title === "string" ? `Close ${title}` : undefined)}
      description={description}
      footer={(
        <DialogActions
          actionLabel={confirmLabel}
          actionTestId={confirmTestId ?? (testId ? `${testId}-confirm` : undefined)}
          cancelLabel={cancelLabel}
          isActionDisabled={isConfirmDisabled || !confirmationMatches}
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
      {confirmationInput ? (
        <FormField helperText={confirmationInput.helperText} label={confirmationInput.label}>
          <Input
            data-testid={confirmationInput.testId}
            disabled={isPending}
            onChange={(event) => confirmationInput.onChange(event.target.value)}
            value={confirmationInput.value}
          />
        </FormField>
      ) : null}
      {children}
      {error ? (
        <Notice className="mt-4" data-testid={testId ? `${testId}-error` : undefined} tone="danger">
          {error}
        </Notice>
      ) : null}
    </Modal>
  );
}

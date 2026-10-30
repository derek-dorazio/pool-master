import { Button } from "./button";

/**
 * A dialog's footer: Cancel, then its one action. While the action runs both are held, and the
 * action shows `pendingLabel` when there is one.
 */
export function DialogActions({
  actionLabel,
  actionTestId,
  cancelLabel,
  isActionDisabled = false,
  isPending,
  onAction,
  onCancel,
  pendingLabel,
  tone = "default",
}: {
  actionLabel: string;
  actionTestId?: string;
  cancelLabel: string;
  isActionDisabled?: boolean;
  isPending: boolean;
  onAction: () => void;
  onCancel: () => void;
  pendingLabel?: string;
  tone?: "default" | "danger";
}) {
  return (
    <>
      <Button disabled={isPending} onClick={onCancel} type="button" variant="secondary">
        {cancelLabel}
      </Button>
      <Button
        data-testid={actionTestId}
        disabled={isActionDisabled}
        isLoading={isPending}
        onClick={onAction}
        type="button"
        variant={tone === "danger" ? "danger" : "primary"}
      >
        {isPending && pendingLabel ? pendingLabel : actionLabel}
      </Button>
    </>
  );
}

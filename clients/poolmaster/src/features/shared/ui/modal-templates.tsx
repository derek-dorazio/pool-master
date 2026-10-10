import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { ConfirmDialog } from "./confirm-dialog";
import { FormField, Input } from "./form-field";
import { Modal } from "./modal";
import { ServerErrorBar } from "./server-error";
import { StatusBadge } from "./status-badge";

type BaseModalTemplateProps = {
  description?: ReactNode;
  onCancel: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  testId?: string;
  title: ReactNode;
};

export type FormModalProps = BaseModalTemplateProps & {
  canSave?: boolean;
  cancelLabel?: string;
  children: ReactNode;
  error?: Error | null;
  errorFallback?: string;
  errorMessage?: ReactNode;
  errorTitle?: string;
  isPending?: boolean;
  onSave: () => void;
  pendingLabel?: string;
  saveLabel: string;
  saveTestId?: string;
  size?: "sm" | "md" | "lg" | "xl";
};

export function FormModal({
  canSave = true,
  cancelLabel = "Cancel",
  children,
  description,
  error,
  errorFallback,
  errorMessage,
  errorTitle,
  isPending = false,
  onCancel,
  onOpenChange,
  onSave,
  open,
  pendingLabel,
  saveLabel,
  saveTestId,
  size = "md",
  testId,
  title,
}: FormModalProps) {
  const visibleSaveLabel = isPending && pendingLabel ? pendingLabel : saveLabel;

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
            data-testid={saveTestId ?? (testId ? `${testId}-save` : undefined)}
            disabled={!canSave || isPending}
            isLoading={isPending}
            onClick={onSave}
            type="button"
          >
            {visibleSaveLabel}
          </Button>
        </>
      }
      isCloseDisabled={isPending}
      onClose={onCancel}
      onOpenChange={onOpenChange}
      open={open}
      size={size}
      testId={testId}
      title={title}
    >
      {children}
      {error ? (
        <ServerErrorBar
          className="mt-4"
          error={error}
          fallback={errorFallback}
          title={errorTitle ?? "Save failed"}
        />
      ) : errorMessage ? (
        <p className="mt-4 text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </Modal>
  );
}

type ConfirmationInput = {
  expectedValue: string;
  helperText?: ReactNode;
  label: string;
  onChange: (value: string) => void;
  testId?: string;
  value: string;
};

export type ConfirmationModalProps = BaseModalTemplateProps & {
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmTestId?: string;
  confirmationInput?: ConfirmationInput;
  errorMessage?: ReactNode;
  isConfirmDisabled?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
  pendingLabel?: string;
  tone?: "default" | "danger";
};

export function ConfirmationModal({
  cancelLabel,
  children,
  confirmLabel,
  confirmTestId,
  confirmationInput,
  description,
  errorMessage,
  isConfirmDisabled = false,
  isPending = false,
  onCancel,
  onConfirm,
  onOpenChange,
  open,
  pendingLabel,
  testId,
  title,
  tone,
}: ConfirmationModalProps) {
  const confirmationMatches = confirmationInput
    ? confirmationInput.value === confirmationInput.expectedValue
    : true;

  return (
    <ConfirmDialog
      cancelLabel={cancelLabel}
      confirmLabel={confirmLabel}
      confirmTestId={confirmTestId}
      description={description}
      isConfirmDisabled={isConfirmDisabled || !confirmationMatches}
      isPending={isPending}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      pendingLabel={pendingLabel}
      testId={testId}
      title={title}
      tone={tone}
    >
      {confirmationInput ? (
        <FormField
          helperText={confirmationInput.helperText}
          label={confirmationInput.label}
        >
          <Input
            data-testid={confirmationInput.testId}
            disabled={isPending}
            onChange={(event) => confirmationInput.onChange(event.target.value)}
            value={confirmationInput.value}
          />
        </FormField>
      ) : null}
      {children}
      {errorMessage ? (
        <p className="mt-4 text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

export type PickerModalItem = {
  id: string;
};

export type PickerModalProps<TItem extends PickerModalItem> =
  BaseModalTemplateProps & {
    canApply?: boolean;
    emptyMessage?: ReactNode;
    errorMessage?: ReactNode;
    getItemLabel: (item: TItem) => string;
    isPending?: boolean;
    itemTestIdPrefix?: string;
    items: readonly TItem[];
    onApply: () => void;
    onSelect: (item: TItem) => void;
    renderItem?: (item: TItem, selected: boolean) => ReactNode;
    search?: {
      label: string;
      onChange: (value: string) => void;
      placeholder?: string;
      value: string;
    };
    selectedId?: string | null;
  };

export function PickerModal<TItem extends PickerModalItem>({
  canApply = true,
  description,
  emptyMessage = "No options are available.",
  errorMessage,
  getItemLabel,
  isPending = false,
  itemTestIdPrefix = "picker-modal-item",
  items,
  onApply,
  onCancel,
  onOpenChange,
  onSelect,
  open,
  renderItem,
  search,
  selectedId,
  testId,
  title,
}: PickerModalProps<TItem>) {
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
            Cancel
          </Button>
          <Button
            data-testid={testId ? `${testId}-apply` : undefined}
            disabled={!canApply || isPending}
            isLoading={isPending}
            onClick={onApply}
            type="button"
          >
            Apply
          </Button>
        </>
      }
      isCloseDisabled={isPending}
      onClose={onCancel}
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      testId={testId}
      title={title}
    >
      {search ? (
        <FormField label={search.label}>
          <Input
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder}
            type="search"
            value={search.value}
          />
        </FormField>
      ) : null}

      <div
        className={cn(
          "grid max-h-96 gap-2 overflow-y-auto pr-1",
          search ? "mt-4" : null,
        )}
      >
        {items.length > 0 ? (
          items.map((item) => {
            const selected = item.id === selectedId;

            return (
              <button
                className={cn(
                  "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition",
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted/40",
                )}
                data-testid={`${itemTestIdPrefix}-${item.id}`}
                key={item.id}
                onClick={() => onSelect(item)}
                type="button"
              >
                <span className="min-w-0">
                  {renderItem ? renderItem(item, selected) : getItemLabel(item)}
                </span>
                {selected ? (
                  <StatusBadge tone="active">
                    <Check aria-hidden size={14} />
                    Selected
                  </StatusBadge>
                ) : null}
              </button>
            );
          })
        ) : (
          <p className="rounded-2xl border border-border bg-background px-4 py-5 text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        )}
      </div>
      {errorMessage ? (
        <p className="mt-4 text-sm font-medium text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </Modal>
  );
}

export type ReadOnlyDetailModalProps = BaseModalTemplateProps & {
  copyLabel?: string;
  details?: Array<{
    id: string;
    label: ReactNode;
    value: ReactNode;
  }>;
  detailContent: ReactNode;
  onCopy?: () => void;
};

export function ReadOnlyDetailModal({
  copyLabel = "Copy details",
  description,
  detailContent,
  details,
  onCancel,
  onCopy,
  onOpenChange,
  open,
  testId,
  title,
}: ReadOnlyDetailModalProps) {
  return (
    <Modal
      description={description}
      footer={
        <>
          {onCopy ? (
            <Button onClick={onCopy} type="button" variant="secondary">
              <Copy aria-hidden size={16} />
              {copyLabel}
            </Button>
          ) : null}
          <Button onClick={onCancel} type="button">
            Close
          </Button>
        </>
      }
      onClose={onCancel}
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      testId={testId}
      title={title}
    >
      {details?.length ? (
        <dl className="grid gap-3 rounded-2xl border border-border bg-background p-4 sm:grid-cols-2">
          {details.map((detail) => (
            <div key={detail.id}>
              <dt className="text-xs uppercase text-muted-foreground">
                {detail.label}
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div
        className={cn(
          "max-h-96 overflow-auto rounded-2xl border border-border bg-background p-4 text-sm text-foreground",
          details?.length ? "mt-4" : null,
        )}
      >
        {detailContent}
      </div>
    </Modal>
  );
}

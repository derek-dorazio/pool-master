import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { CopyButton } from "./copy-button";
import { DialogActions } from "./dialog-actions";
import { FormField, Input } from "./form-field";
import { Notice } from "./notice";
import { FactList } from "./fact-list";
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
  return (
    <Modal
      description={description}
      footer={(
        <DialogActions
          actionLabel={saveLabel}
          actionTestId={saveTestId ?? (testId ? `${testId}-save` : undefined)}
          cancelLabel={cancelLabel}
          isActionDisabled={!canSave}
          isPending={isPending}
          onAction={onSave}
          onCancel={onCancel}
          pendingLabel={pendingLabel}
        />
      )}
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
        <Notice className="mt-4" tone="danger">
          {errorMessage}
        </Notice>
      ) : null}
    </Modal>
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
    /** Fields shown above the search, such as a choice of source. */
    filters?: ReactNode;
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
  filters,
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
      {filters ? <div className={search ? "mb-4" : undefined}>{filters}</div> : null}
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
                  "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition",
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
          <p className="rounded-lg border border-border bg-background px-4 py-5 text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        )}
      </div>
      {errorMessage ? (
        <Notice className="mt-4" tone="danger">
          {errorMessage}
        </Notice>
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
  /** What Copy puts on the clipboard; without it the modal has no Copy button. */
  copyText?: string;
  /** Fills a phone's screen, for a dialog that holds a whole page. */
  isFullScreenOnPhone?: boolean;
  /**
   * `sm` for a sentence or two, such as why an action isn't available. `xl` for a whole page,
   * such as a pick screen's preview: the content sits unboxed and the dialog itself scrolls.
   */
  size?: "sm" | "lg" | "xl";
};

export function ReadOnlyDetailModal({
  copyLabel = "Copy details",
  copyText,
  description,
  detailContent,
  details,
  isFullScreenOnPhone = false,
  onCancel,
  onOpenChange,
  open,
  size = "lg",
  testId,
  title,
}: ReadOnlyDetailModalProps) {
  return (
    <Modal
      description={description}
      footer={
        <>
          {copyText === undefined ? null : <CopyButton label={copyLabel} text={copyText} />}
          <Button onClick={onCancel} type="button">
            Close
          </Button>
        </>
      }
      isFullScreenOnPhone={isFullScreenOnPhone}
      onClose={onCancel}
      onOpenChange={onOpenChange}
      open={open}
      size={size}
      testId={testId}
      title={title}
    >
      {details?.length ? (
        <FactList columns={2} facts={details} layout="columns" />
      ) : null}
      <div
        className={cn(
          size === "xl"
            ? null
            : "max-h-96 overflow-auto rounded-lg border border-border bg-background p-4 text-sm text-foreground",
          details?.length ? "mt-4" : null,
        )}
        data-testid={testId ? `${testId}-content` : undefined}
      >
        {detailContent}
      </div>
    </Modal>
  );
}

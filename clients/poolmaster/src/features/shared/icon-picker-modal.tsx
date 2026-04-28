import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

type IconPickerOption<Key extends string> = {
  key: Key;
  label: string;
};

type IconPickerModalProps<Key extends string, Option extends IconPickerOption<Key>> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  descriptionId: string;
  modalTestId: string;
  paletteTestId: string;
  optionTestIdPrefix: string;
  saveTestId: string;
  closeLabel: string;
  options: Option[];
  value: Key;
  selectedLabel: string;
  canSelect: boolean;
  canSave: boolean;
  isPending: boolean;
  errorMessage?: string | null;
  onSelect: (key: Key) => void;
  onCancel: () => void;
  onSave: () => void;
  renderSelectedIcon: () => ReactNode;
  renderOptionIcon: (option: Option) => ReactNode;
};

export function IconPickerModal<Key extends string, Option extends IconPickerOption<Key>>({
  open,
  onOpenChange,
  title,
  description,
  descriptionId,
  modalTestId,
  paletteTestId,
  optionTestIdPrefix,
  saveTestId,
  closeLabel,
  options,
  value,
  selectedLabel,
  canSelect,
  canSave,
  isPending,
  errorMessage,
  onSelect,
  onCancel,
  onSave,
  renderSelectedIcon,
  renderOptionIcon,
}: IconPickerModalProps<Key, Option>) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={descriptionId}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] border border-border bg-card p-5 shadow-2xl sm:p-6"
          data-testid={modalTestId}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-2xl font-semibold tracking-tight">
                {title}
              </Dialog.Title>
              <Dialog.Description
                className="mt-2 text-sm text-muted-foreground"
                id={descriptionId}
              >
                {description}
              </Dialog.Description>
            </div>
            <button
              aria-label={closeLabel}
              className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isPending}
              onClick={onCancel}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="mt-4 rounded-[1.5rem] border border-border bg-background p-4 sm:p-5">
            <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-card px-4 py-4">
              {renderSelectedIcon()}
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Selected icon
                </div>
                <div className="mt-1 text-base font-medium">{selectedLabel}</div>
              </div>
            </div>

            <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" data-testid={paletteTestId}>
              {options.map((icon) => {
                const isSelected = value === icon.key;
                return (
                  <button
                    className={`rounded-[1rem] border px-2 py-3 text-center transition ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                    }`}
                    data-testid={`${optionTestIdPrefix}-${icon.key}`}
                    disabled={!canSelect}
                    key={icon.key}
                    onClick={() => onSelect(icon.key)}
                    type="button"
                  >
                    {renderOptionIcon(icon)}
                    <div className="mt-2 text-xs font-medium">{icon.label}</div>
                  </button>
                );
              })}
            </div>

            {errorMessage ? (
              <p className="mt-4 text-sm text-destructive">{errorMessage}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-3">
              <button
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                data-testid={saveTestId}
                disabled={!canSave}
                onClick={onSave}
                type="button"
              >
                {isPending ? 'Saving...' : 'Save icon'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

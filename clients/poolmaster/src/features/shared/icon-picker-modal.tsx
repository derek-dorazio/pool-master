import type { ReactNode } from "react";
import { Button, Modal, Tile } from "@/features/shared/ui";

type IconPickerOption<Key extends string> = {
  key: Key;
  label: string;
};

type IconPickerModalProps<
  Key extends string,
  Option extends IconPickerOption<Key>,
> = {
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

export function IconPickerModal<
  Key extends string,
  Option extends IconPickerOption<Key>,
>({
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
    <Modal
      closeLabel={closeLabel}
      description={description}
      descriptionId={descriptionId}
      isCloseDisabled={isPending}
      onClose={onCancel}
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      testId={modalTestId}
      title={title}
    >
      <Tile className="sm:p-5" padding="sm" radius="lg" variant="subtle">
        <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-card px-4 py-4">
          {renderSelectedIcon()}
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Selected icon
            </div>
            <div className="mt-1 text-base font-medium">{selectedLabel}</div>
          </div>
        </div>

        <div
          className="mt-4 grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-4"
          data-testid={paletteTestId}
        >
          {options.map((icon) => {
            const isSelected = value === icon.key;
            return (
              <button
                className={`rounded-[1rem] border px-2 py-3 text-center transition ${
                  isSelected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40"
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
          <Button
            disabled={isPending}
            onClick={onCancel}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            data-testid={saveTestId}
            disabled={!canSave}
            isLoading={isPending}
            onClick={onSave}
            type="button"
          >
            {isPending ? "Saving..." : "Save icon"}
          </Button>
        </div>
      </Tile>
    </Modal>
  );
}

import type { ReactNode } from "react";
import { cn } from "./class-names";

export type IconPaletteOption<Key extends string> = {
  key: Key;
  label: string;
};

type IconPaletteProps<Key extends string, Option extends IconPaletteOption<Key>> = {
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  onSelect: (key: Key) => void;
  optionTestIdPrefix: string;
  options: readonly Option[];
  renderOptionIcon: (option: Option) => ReactNode;
  testId: string;
  value: Key;
};

/** A grid of icons to choose one from; the chosen one is pressed. */
export function IconPalette<Key extends string, Option extends IconPaletteOption<Key>>({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  onSelect,
  optionTestIdPrefix,
  options,
  renderOptionIcon,
  testId,
  value,
}: IconPaletteProps<Key, Option>) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn("grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4", className)}
      data-testid={testId}
      role="group"
    >
      {options.map((icon) => {
        const isSelected = value === icon.key;
        return (
          <button
            aria-pressed={isSelected}
            className={cn(
              "rounded-[1rem] border px-2 py-3 text-center transition",
              isSelected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted/40",
            )}
            data-testid={`${optionTestIdPrefix}-${icon.key}`}
            disabled={disabled}
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
  );
}

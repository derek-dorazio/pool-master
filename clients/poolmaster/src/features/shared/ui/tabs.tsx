import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "./class-names";
import { radioGroupKeyboard } from "./radio-group-keys";

export const Tabs = TabsPrimitive.Root;

export const TabsContent = TabsPrimitive.Content;

type SegmentedControlOption = {
  disabled?: boolean;
  label: string;
  testId?: string;
  value: string;
};

type SegmentedControlProps = {
  "aria-label": string;
  onChange: (value: string) => void;
  options: SegmentedControlOption[];
  value: string;
};

export function SegmentedControl({
  "aria-label": ariaLabel,
  onChange,
  options,
  value,
}: SegmentedControlProps) {
  const keyboard = radioGroupKeyboard(options, value, onChange);
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex max-w-full flex-wrap rounded-2xl border border-border bg-background p-1"
      role="radiogroup"
      {...keyboard.group}
    >
      {options.map((option) => (
        <button
          aria-checked={value === option.value}
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-60",
            value === option.value
              ? "bg-selected text-on-inverse"
              : "hover:bg-muted/40",
          )}
          data-testid={option.testId}
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          tabIndex={keyboard.tabIndexFor(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

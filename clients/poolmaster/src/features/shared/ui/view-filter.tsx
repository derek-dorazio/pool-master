import { cn } from "./class-names";
import { useScrollRow } from "./scroll-row";

export type ViewFilterOption = {
  /** How many rows the view holds, shown small after its name. */
  count?: number;
  label: string;
  testId?: string;
  value: string;
};

export type ViewFilterProps = {
  "aria-label": string;
  onChange: (value: string) => void;
  options: ViewFilterOption[];
  value: string;
};

/**
 * Which rows a list shows (Active / History, Pending / Expired), as quiet underlined choices with
 * a small count: the look of `PageTabs`, but a radio group, because it narrows one list rather
 * than opening another view. It sits in a `DataGrid`'s header through `views`. On a phone the row
 * scrolls sideways and keeps the chosen view in sight (`useScrollRow`).
 */
export function ViewFilter({ "aria-label": ariaLabel, onChange, options, value }: ViewFilterProps) {
  const { fadeClassName, ref } = useScrollRow<HTMLDivElement>();
  return (
    <div aria-label={ariaLabel} className={cn("relative flex min-w-0 gap-5 overflow-x-auto", fadeClassName)} ref={ref} role="radiogroup">
      {options.map((option) => {
        const isChosen = option.value === value;
        return (
          <button
            aria-checked={isChosen}
            className={cn(
              "whitespace-nowrap border-b-2 pb-2.5 pt-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              isChosen ? "border-selected text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            data-testid={option.testId}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
            {option.count === undefined ? null : (
              <>
                {" "}
                <span className="text-xs font-medium tabular-nums text-muted-foreground">{option.count}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

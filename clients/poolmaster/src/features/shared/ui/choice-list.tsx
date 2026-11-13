import { Link } from "react-router";
import { cn } from "./class-names";

/**
 * One line of a `ChoiceList`: a link to the page with it chosen, marked `aria-current="page"`
 * while it is. `depth` indents it under the line before (a sport, its league, the league's
 * round); `tone` sets a heading line in the display face (`heading`), a quiet one such as
 * "+ 3 more" (`muted`), or a plain one.
 */
export type ChoiceListItem = {
  /** How many choices it holds, shown small at the line's end. */
  count?: number;
  depth?: 0 | 1 | 2;
  isChosen: boolean;
  label: string;
  /** Runs as the link is followed, before the page shows the choice. */
  onClick?: () => void;
  testId?: string;
  to: string;
  tone?: "default" | "heading" | "muted";
};

const DEPTH_CLASS_NAMES = { 0: "pl-2", 1: "pl-4", 2: "pl-7" } as const;
const TONE_CLASS_NAMES = {
  default: "text-sm font-medium text-foreground",
  heading: "font-display text-sm font-bold text-foreground",
  muted: "text-sm font-medium text-muted-foreground",
} as const;

/**
 * Choices as a column of indented links in a card, such as every sport and league beside How to
 * Play's ways to play (#1701). The chosen line is tinted with the selected-blue edge. Pass
 * `className` for the column's place, such as `sticky top-4`.
 */
export function ChoiceList({
  "aria-label": ariaLabel,
  className,
  items,
  testId,
}: {
  "aria-label": string;
  className?: string;
  items: readonly ChoiceListItem[];
  testId?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={cn("rounded-lg border border-border bg-card p-2", className)} data-testid={testId}>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              aria-current={item.isChosen ? "page" : undefined}
              className={cn(
                "flex items-baseline justify-between gap-2 rounded-md border-l-2 py-1 pr-2 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                DEPTH_CLASS_NAMES[item.depth ?? 0],
                TONE_CLASS_NAMES[item.tone ?? "default"],
                item.isChosen ? "border-selected bg-muted font-semibold" : "border-transparent",
              )}
              data-testid={item.testId}
              onClick={item.onClick}
              replace
              to={item.to}
            >
              <span className="min-w-0">{item.label}</span>
              {item.count === undefined ? null : (
                <>
                  {" "}
                  <span className="shrink-0 font-body text-xs font-medium tabular-nums text-muted-foreground">{item.count}</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

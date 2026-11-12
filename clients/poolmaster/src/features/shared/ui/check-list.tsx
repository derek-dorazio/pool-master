import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Text } from "./text";

/** One requirement and whether it is met. */
export type CheckItem = {
  id: string;
  label: ReactNode;
  isMet: boolean;
  testId?: string;
};

/** What the list sits on: a normal card, or a navy panel. */
export type CheckListSurface = "default" | "inverse";

export type CheckListProps = {
  items: readonly CheckItem[];
  surface?: CheckListSurface;
  /** Spacing around the list only, such as a top margin. */
  className?: string;
  testId?: string;
};

/** A met item's filled check: the brand fill, on a card and on a navy panel alike. */
const MET_MARK = "bg-primary text-primary-foreground";

/** A missing item's outlined cross, in the surface's full-contrast text colour. */
const UNMET_MARK: Record<CheckListSurface, string> = {
  default: "border-[1.5px] border-current text-foreground",
  inverse: "border-[1.5px] border-current text-on-inverse",
};

/** Done items dim; missing ones stay at full contrast. */
const LABEL_TONE: Record<CheckListSurface, { met: string; unmet: string }> = {
  default: { met: "text-muted-foreground", unmet: "text-foreground" },
  inverse: { met: "text-on-inverse-muted", unmet: "text-on-inverse" },
};

/**
 * Requirements, one per line: what is still missing first, at full contrast behind an outlined
 * cross, then what is done, dimmed behind a filled check. A contest's readiness to open, a
 * setup's checks, a plan's limits. Each item keeps its order within its group.
 */
export function CheckList({ className, items, surface = "default", testId }: CheckListProps) {
  const ordered = [...items.filter((item) => !item.isMet), ...items.filter((item) => item.isMet)];
  return (
    <ul className={cn("m-0 grid list-none gap-1.5 p-0", className)} data-testid={testId}>
      {ordered.map((item) => (
        <li className="flex items-center gap-2" data-met={item.isMet} data-testid={item.testId} key={item.id}>
          <span
            aria-hidden
            className={cn(
              "inline-grid size-[18px] shrink-0 place-items-center rounded-full",
              item.isMet ? MET_MARK : UNMET_MARK[surface],
            )}
          >
            {item.isMet ? <Check size={12} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
          </span>
          <Text className={item.isMet ? LABEL_TONE[surface].met : LABEL_TONE[surface].unmet}>
            <span className="sr-only">{item.isMet ? "Done: " : "Missing: "}</span>
            {item.label}
          </Text>
        </li>
      ))}
    </ul>
  );
}

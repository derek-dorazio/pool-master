import type { SortDirection } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./class-names";

const SORTED_WORDS: Record<SortDirection, string> = { asc: "sorted ascending", desc: "sorted descending" };

/**
 * A column's name in its header, as the button that sorts by it: ascending, then descending, then
 * not at all. Beside the name, a faint ⇅ until the header is hovered; a sorted column shows one
 * arrow in the accent colour. A column's (i) sits between the name and the arrow, so the arrow
 * is then a second, mouse-only way to sort: the name stays the one a keyboard reaches.
 */
export function DataGridSortButton({
  children,
  direction,
  info,
  onClick,
  testId,
  tone,
}: {
  children: ReactNode;
  direction: false | SortDirection;
  /** The column's (i), drawn right after its name. */
  info?: ReactNode;
  onClick: () => void;
  testId: string;
  tone: "plain" | "scoreboard";
}) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  const look = cn(
    "inline-flex items-center gap-1.5 text-left text-inherit [text-transform:inherit] transition",
    tone === "scoreboard" ? "hover:text-on-inverse" : "hover:text-foreground",
  );
  const arrow = (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3 flex-none transition-opacity",
        direction
          ? tone === "scoreboard" ? "text-on-inverse" : "text-selected"
          : "opacity-40 group-hover/header:opacity-100",
      )}
      strokeWidth={2.25}
    />
  );
  const name = (
    <>
      <span>{children}</span>
      <span className="sr-only">{direction ? `, ${SORTED_WORDS[direction]}` : ""}</span>
    </>
  );
  if (!info) {
    return (
      <button className={look} data-sorted={direction || undefined} data-testid={testId} onClick={onClick} type="button">
        {name}
        {arrow}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button className={look} data-sorted={direction || undefined} data-testid={testId} onClick={onClick} type="button">
        {name}
      </button>
      {info}
      <button aria-hidden="true" className={look} onClick={onClick} tabIndex={-1} type="button">
        {arrow}
      </button>
    </span>
  );
}

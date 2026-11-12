import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode, type Ref } from "react";
import { cn } from "./class-names";

type ExpandableRowLook = "bar" | "card" | "row";

/**
 * Expand (more-info pattern 3): "show me the breakdown". A row with a chevron at its right end;
 * clicking or tapping anywhere on it opens its breakdown in place beneath it, and it stays open
 * until closed, so several rows can be open to compare. It never opens on hover.
 *
 * The whole row is one button laid over the summary, so the summary can carry a button or link
 * of its own (an entry's (i) peek) that sits above it and keeps working.
 *
 * Uncontrolled by default (`defaultOpen`); a page that must keep rows open across reloads of its
 * data passes `isOpen` and `onToggle`.
 */
export function ExpandableRow({
  children,
  className,
  defaultOpen = false,
  isOpen: controlledIsOpen,
  label,
  look = "row",
  onToggle,
  rowClassName,
  rowTestId,
  summary,
  testId,
  toggleRef,
  toggleTestId,
}: {
  /** The breakdown, shown only while open. */
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  isOpen?: boolean;
  /** The toggle's accessible name: what opens, such as "Picks for Incubus 1". */
  label: string;
  /**
   * `row` is a plain section row; `bar` is the shaded bar that heads a leaderboard entry; `card`
   * is the roomier head of a card that opens, such as a tier of the picks.
   */
  look?: ExpandableRowLook;
  onToggle?: () => void;
  /**
   * Layout for the clickable row alone, not its breakdown: such as keeping it pinned at the
   * visible width inside a board that scrolls sideways. Never type styles.
   */
  rowClassName?: string;
  /** The clickable row's test id; `<testId>-row` when left out. */
  rowTestId?: string;
  /** What the row shows open or closed: its name, facts and figure. */
  summary: ReactNode;
  testId?: string;
  /** The toggle button itself, for a page that moves focus to the row it opens next. */
  toggleRef?: Ref<HTMLButtonElement>;
  /** The toggle button's test id; `<testId>-toggle` when left out. */
  toggleTestId?: string;
}) {
  const [ownIsOpen, setOwnIsOpen] = useState(defaultOpen);
  const isOpen = controlledIsOpen ?? ownIsOpen;
  const panelId = useId();
  const toggle = () => {
    if (controlledIsOpen === undefined) {
      setOwnIsOpen((open) => !open);
    }
    onToggle?.();
  };

  return (
    <div className={className} data-open={isOpen || undefined} data-testid={testId}>
      <div
        className={cn(
          "relative flex items-center gap-3 px-4 transition hover:bg-row-hover",
          look === "bar" ? "bg-muted py-3" : look === "card" ? "py-4" : "py-2",
          isOpen ? "border-b border-border" : undefined,
          rowClassName,
        )}
        data-testid={rowTestId ?? (testId ? `${testId}-row` : undefined)}
      >
        <button
          aria-controls={panelId}
          aria-expanded={isOpen}
          aria-label={label}
          className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid={toggleTestId ?? (testId ? `${testId}-toggle` : undefined)}
          onClick={toggle}
          ref={toggleRef}
          type="button"
        />
        {/* Taps on the summary fall through to the toggle; its own buttons and links stay live. */}
        <div className="pointer-events-none relative min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          {summary}
        </div>
        <ChevronDown
          aria-hidden
          className={cn("pointer-events-none relative size-4 flex-none text-muted-foreground transition-transform", isOpen ? "rotate-180" : undefined)}
        />
      </div>
      {isOpen ? (
        <div data-testid={testId ? `${testId}-details` : undefined} id={panelId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

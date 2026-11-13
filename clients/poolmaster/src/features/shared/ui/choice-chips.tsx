import { X } from "lucide-react";
import { Link } from "react-router";
import { cn } from "./class-names";
import { Icon } from "./icon";
import { useScrollRow } from "./scroll-row";

/** One choice: a link to the page with it chosen, marked `aria-current="page"` while it is. */
export type ChoiceChip = {
  isChosen: boolean;
  label: string;
  /** Runs as the link is followed, before the page shows the choice: scroll back to the results, say. */
  onClick?: () => void;
  testId?: string;
  to: string;
};

/**
 * A narrower choice drawn in place of the row's choice it narrows (`replaces`, that choice's
 * `to`), chosen and with an ×: following it clears it, back to the choice it replaced, and it is
 * named "Clear …" for screen readers.
 */
export type ClearableChoiceChip = { label: string; replaces: string; testId?: string };

const CHIP_CLASS_NAME =
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHOSEN_CLASS_NAME = "border-selected bg-selected text-on-inverse";
const UNCHOSEN_CLASS_NAME = "border-border bg-card text-foreground hover:border-selected";

/**
 * Choices as a row of pill links, such as a page's sport switch on a phone (#1701). `layout="scroll"`
 * keeps them on one line that scrolls sideways and keeps the chosen one in view (`useScrollRow`);
 * `"wrap"` lets them wrap, for a list of every choice. `clearable` draws a narrower choice in
 * place of the one it narrows: NHL · Stanley Cup Final where Hockey was.
 */
export function ChoiceChips({
  "aria-label": ariaLabel,
  clearable,
  items,
  layout = "scroll",
  testId,
}: {
  "aria-label": string;
  clearable?: ClearableChoiceChip;
  items: readonly ChoiceChip[];
  layout?: "scroll" | "wrap";
  testId?: string;
}) {
  const { fadeClassName, ref } = useScrollRow<HTMLElement>();
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "relative flex min-w-0 gap-2",
        layout === "scroll" ? cn("-mx-1 overflow-x-auto px-1 py-0.5", fadeClassName) : "flex-wrap",
      )}
      data-testid={testId}
      ref={layout === "scroll" ? ref : undefined}
    >
      {items.map((item) => (clearable?.replaces === item.to ? (
        <Link
          aria-label={`Clear ${clearable.label}`}
          className={cn(CHIP_CLASS_NAME, CHOSEN_CLASS_NAME)}
          data-chosen="true"
          data-testid={clearable.testId}
          key={item.to}
          onClick={item.onClick}
          replace
          to={item.to}
        >
          {clearable.label}
          <Icon className="h-4 w-4" icon={X} />
        </Link>
      ) : (
        <Link
          aria-current={item.isChosen && !clearable ? "page" : undefined}
          className={cn(CHIP_CLASS_NAME, item.isChosen && !clearable ? CHOSEN_CLASS_NAME : UNCHOSEN_CLASS_NAME)}
          data-testid={item.testId}
          key={item.to}
          onClick={item.onClick}
          replace
          to={item.to}
        >
          {item.label}
        </Link>
      )))}
    </nav>
  );
}

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./class-names";

type PageTabBase = {
  /** How many things the view holds, shown small after its name. */
  count?: number;
  label: string;
  testId?: string;
};

/** A view with its own address: a link, marked `aria-current="page"` while it is open. */
export type PageLinkTab = PageTabBase & { isActive: boolean; to: string };

/** A view held in the page's state: a Radix tab, so the arrow keys move between them. */
export type PageStateTab = PageTabBase & { value: string };

type PageTabsProps = { "aria-label": string } & (
  | { variant: "link"; items: PageLinkTab[] }
  /** Sits inside the page's own Radix `Tabs` root, which also holds the `TabsContent`. */
  | { variant: "state"; items: PageStateTab[] }
);

// On a phone the tabs can run past the edge; the faded right edge says the row scrolls, as the
// league menu's does.
const ROW_CLASS_NAME =
  "flex min-w-0 gap-6 overflow-x-auto max-sm:pr-12 max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)]";

// The selected-tab blue underline, one level below the league menu's gold one.
const TAB_CLASS_NAME =
  "whitespace-nowrap border-b-2 border-transparent pb-2.5 pt-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ACTIVE_TAB_CLASS_NAME = "border-selected text-foreground";

function TabLabel({ count, label }: PageTabBase) {
  return (
    <>
      {label}
      {count === undefined ? null : (
        <>
          {" "}
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
        </>
      )}
    </>
  );
}

/**
 * The views of one page as quiet underlined tabs, for `PageHeader`'s `tabs` slot. Route-backed
 * views are links; views held in state are Radix tabs. Never a `SegmentedControl`, which is for
 * choosing a value inside a form or panel.
 */
export function PageTabs(props: PageTabsProps): ReactNode {
  if (props.variant === "link") {
    return (
      <nav aria-label={props["aria-label"]} className={ROW_CLASS_NAME}>
        {props.items.map((item) => (
          <Link
            aria-current={item.isActive ? "page" : undefined}
            className={cn(TAB_CLASS_NAME, item.isActive && ACTIVE_TAB_CLASS_NAME)}
            data-testid={item.testId}
            key={item.to}
            to={item.to}
          >
            <TabLabel count={item.count} label={item.label} />
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <TabsPrimitive.List aria-label={props["aria-label"]} className={ROW_CLASS_NAME}>
      {props.items.map((item) => (
        <TabsPrimitive.Trigger
          className={cn(TAB_CLASS_NAME, "data-[state=active]:border-selected data-[state=active]:text-foreground")}
          data-testid={item.testId}
          key={item.value}
          value={item.value}
        >
          <TabLabel count={item.count} label={item.label} />
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  );
}

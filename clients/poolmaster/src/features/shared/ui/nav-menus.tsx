import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./class-names";
import { Eyebrow } from "./eyebrow";
import { type PageLinkTab, PageTabs } from "./page-tabs";
import { useScrollRow } from "./scroll-row";

export type NavMenuItem = {
  isActive: boolean;
  label: ReactNode;
  testId: string;
  to: string;
};

type LeagueMenuProps = {
  /** Trailing control at the menu's right end, such as the Commissioner tools button. */
  action?: ReactNode;
  "aria-label": string;
  items: NavMenuItem[];
};

/**
 * The menu every member page in a league shares, under the app bar. One row of links; the
 * current page is marked with `aria-current` and an accent underline.
 */
export function LeagueMenu({ action, "aria-label": ariaLabel, items }: LeagueMenuProps) {
  const { fadeClassName, ref } = useScrollRow<HTMLDivElement>();
  return (
    <nav aria-label={ariaLabel} className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 sm:px-6">
        {/* On a phone the links can run past the edge: the row keeps the current page in view and
            fades the edges with more links beyond them. */}
        <div className={cn("relative flex min-w-0 flex-1 gap-1 overflow-x-auto", fadeClassName)} data-testid="league-menu-links" ref={ref}>
          {items.map((item) => (
            <Link
              aria-current={item.isActive ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold uppercase tracking-button transition",
                item.isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={item.testId}
              key={item.testId}
              to={item.to}
            >
              {item.label}
            </Link>
          ))}
        </div>
        {action ? <div className="flex-none">{action}</div> : null}
      </div>
    </nav>
  );
}

type ToolsAreaProps = {
  back: { label: string; testId: string; to: string };
  children: ReactNode;
  /** The area's name, in gold at the band's start, e.g. "Commissioner tools". */
  eyebrow: string;
  /** The area's tools, one tab each; a tool's sub-pages keep its tab lit. */
  tabs: PageLinkTab[];
  tabsLabel: string;
  /**
   * A second row under the tabs for the open tool's own choices, such as one tab per sport
   * under Sports. It scrolls on a phone and keeps the selected one in view.
   */
  subTabs?: { items: PageLinkTab[]; label: string };
  testId?: string;
  /** What the tools act on, e.g. the league's name. */
  title: ReactNode;
};

/**
 * A tools area (#1562): a slim navy band saying which area you are in and the way back, the
 * area's tools as one row of `PageTabs` on every width, an optional second row for the open
 * tool's own choices, then the page, which opens with its own `PageHeader`. No side menu, so
 * tables get the full width.
 */
export function ToolsArea({ back, children, eyebrow, subTabs, tabs, tabsLabel, testId, title }: ToolsAreaProps) {
  return (
    <div className="space-y-6" data-testid={testId}>
      <div className="space-y-3">
        <div
          className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-inverse-deep px-4 py-2 text-sm text-on-inverse"
          data-testid={testId ? `${testId}-band` : undefined}
        >
          <Eyebrow tone="highlight">{eyebrow}</Eyebrow>
          <span className="min-w-0 truncate font-medium">{title}</span>
          <Link
            className="ml-auto whitespace-nowrap font-semibold underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={back.testId}
            to={back.to}
          >
            {back.label}
          </Link>
        </div>
        <div className="border-b border-border">
          <PageTabs aria-label={tabsLabel} items={tabs} variant="link" />
        </div>
        {subTabs ? (
          <div className="border-b border-border">
            <PageTabs aria-label={subTabs.label} items={subTabs.items} variant="link" />
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

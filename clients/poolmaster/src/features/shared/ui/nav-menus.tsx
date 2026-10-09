import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "./class-names";

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
  return (
    <nav aria-label={ariaLabel} className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {items.map((item) => (
            <Link
              aria-current={item.isActive ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition",
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

type AdminAreaLayoutProps = {
  back: { label: string; testId: string; to: string };
  children: ReactNode;
  /** The area's name, shown above the title, e.g. "Commissioner tools". */
  eyebrow: string;
  icon?: ReactNode;
  menuLabel: string;
  menuItems: NavMenuItem[];
  testId?: string;
  title: ReactNode;
};

/**
 * An administration area: a dark area header with a way back, a side menu, and the page.
 * Kept apart from the member pages so routine use never sits beside administration.
 */
export function AdminAreaLayout({
  back,
  children,
  eyebrow,
  icon,
  menuItems,
  menuLabel,
  testId,
  title,
}: AdminAreaLayoutProps) {
  return (
    <div className="space-y-6" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-inverse-border bg-surface-inverse-deep px-5 py-3 text-on-inverse">
        {icon ? <span className="text-primary">{icon}</span> : null}
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </div>
          <div className="truncate font-semibold">{title}</div>
        </div>
        <Link
          className="ml-auto whitespace-nowrap rounded-pill border border-inverse-border px-3 py-1.5 text-sm transition hover:bg-on-inverse-hover"
          data-testid={back.testId}
          to={back.to}
        >
          {back.label}
        </Link>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label={menuLabel} className="flex gap-1 overflow-x-auto md:sticky md:top-4 md:flex-col">
          {menuItems.map((item) => (
            <Link
              aria-current={item.isActive ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition",
                item.isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={item.testId}
              key={item.testId}
              to={item.to}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

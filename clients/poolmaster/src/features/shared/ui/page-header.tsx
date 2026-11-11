import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { IconAvatar } from "./icon-avatar";

type Breadcrumb = {
  href?: string;
  label: string;
};

export type PageHeaderProps = {
  breadcrumbLabel?: string;
  /** The trail up to this page, for an administration area's nested pages. */
  breadcrumbs?: Breadcrumb[];
  /**
   * A line under the facts for a rule the reader needs ("Members never see which plan it is
   * on"), or the entity's own words, such as a league's description. Never a sentence saying
   * what the page is: the title and the tab name already say it.
   */
  description?: ReactNode;
  /** One short muted line of facts, such as "12 members · 2 active contests". */
  meta?: ReactNode;
  /** The page's views, as `PageTabs`, on the header's bottom line. */
  tabs?: ReactNode;
  /**
   * A filter that changes every tab, such as a season picker, alone at the tab row's right end
   * (on a phone, its own line under the tabs). Shown only with `tabs`.
   */
  tabsEnd?: ReactNode;
  testId?: string;
  title: string;
} & (
  /**
   * The right slot holds at most two small buttons about this page's subject. They sit beside
   * the title while they fit, and wrap under it on a phone when they don't.
   */
  | { actions?: ReactNode; search?: never }
  /** Or the page's search box: beside the title on a desktop, a full-width line on a phone. */
  | { search: ReactNode; actions?: never }
) & (
  /** An icon, drawn in the standard avatar square and named `<title> icon`. */
  | { icon?: ReactNode; avatar?: never }
  /** A whole avatar of the caller's own, such as a team's in its icon colours. */
  | { avatar: ReactNode; icon?: never }
);

/**
 * The one header at the top of a page: the title straight on the page (no card), an optional
 * icon, fact line and right slot, then the page's views as tabs on a ruled bottom line. Title,
 * facts and tabs stay within about 100px on a desktop and 120px on a phone.
 */
export function PageHeader({
  actions,
  avatar,
  breadcrumbLabel = "Breadcrumbs",
  breadcrumbs,
  description,
  icon,
  meta,
  search,
  tabs,
  tabsEnd,
  testId,
  title,
}: PageHeaderProps) {
  const picture = avatar ?? (icon ? (
    <IconAvatar label={`${title} icon`} size="md">
      {icon}
    </IconAvatar>
  ) : null);

  return (
    <header data-testid={testId}>
      <div
        className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", tabs ? "pb-2" : "border-b border-border pb-3.5")}
        data-testid={testId ? `${testId}-title-row` : undefined}
      >
        {picture}
        <div className="min-w-0 flex-1">
          <Heading data-testid={testId ? `${testId}-name` : undefined} level={1} variant="pageTitle">
            {title}
          </Heading>
          {meta ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {meta}
            </div>
          ) : null}
          {description ? (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
          {breadcrumbs?.length ? (
            <Breadcrumbs className="mt-2" items={breadcrumbs} label={breadcrumbLabel} />
          ) : null}
        </div>
        {search ? (
          <div className="max-sm:basis-full sm:w-72" data-testid={testId ? `${testId}-search` : undefined}>
            {search}
          </div>
        ) : null}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2" data-testid={testId ? `${testId}-actions` : undefined}>
            {actions}
          </div>
        ) : null}
      </div>
      {tabs ? (
        // The rule runs under the whole tab row; on a phone it runs under the tabs alone, and the
        // filter drops below it.
        <div
          className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:border-b sm:border-border"
          data-testid={testId ? `${testId}-tab-row` : undefined}
        >
          <div className="min-w-0 max-sm:basis-full max-sm:border-b max-sm:border-border">{tabs}</div>
          {tabsEnd ? <div className="flex items-center gap-2 text-sm text-muted-foreground sm:pb-2">{tabsEnd}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

/** A trail of links up to the current page, which is marked with `aria-current`. */
export function Breadcrumbs({
  className,
  items,
  label = "Breadcrumbs",
}: {
  className?: string;
  items: Breadcrumb[];
  label?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {items.map((breadcrumb, index) => {
          const isLast = index === items.length - 1;

          return (
            <Fragment
              key={`${breadcrumb.label}-${breadcrumb.href ?? index}`}
            >
              <li>
                {isLast || !breadcrumb.href ? (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className="font-medium text-foreground"
                  >
                    {breadcrumb.label}
                  </span>
                ) : (
                  <Link
                    className="font-medium text-primary transition hover:opacity-80"
                    to={breadcrumb.href}
                  >
                    {breadcrumb.label}
                  </Link>
                )}
              </li>
              {!isLast ? (
                <li
                  aria-hidden="true"
                  className="text-muted-foreground/70"
                >
                  /
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

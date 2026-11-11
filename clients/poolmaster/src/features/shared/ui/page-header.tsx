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
  /** The trail up to this page, on the header's first line above the title. */
  breadcrumbs?: Breadcrumb[];
  /**
   * A line under the facts for a rule the reader needs ("Members never see which plan it is
   * on"), or the entity's own words, such as a league's description. Never a sentence saying
   * what the page is: the title and the tab name already say it.
   */
  description?: ReactNode;
  /** One short muted line of facts, such as "12 members · 2 active contests". */
  meta?: ReactNode;
  /**
   * One compact chip at the far right of the header's first line: a status, count or summary,
   * such as a contest's Live or Final, "12 entries" or "3 members". It sits beside the
   * breadcrumb when there is one, otherwise at the end of the title row, after any actions, and
   * stays on the first line on a phone, so it adds no height.
   */
  status?: ReactNode;
  /** The page's views, as `PageTabs`, on the header's bottom line. */
  tabs?: ReactNode;
  /**
   * A filter that changes every tab, such as a season picker, alone at the tab row's right end
   * (on a phone, its own line under the tabs). Shown only with `tabs`.
   */
  tabsEnd?: ReactNode;
  testId?: string;
  title: string;
  /** Beside the title, such as an info icon whose callout holds the subject's status. */
  titleAside?: ReactNode;
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
 * The one header at the top of a page: an optional breadcrumb line, the title straight on the
 * page (no card), an optional icon, fact line, right slot and status chip, then the page's views
 * as tabs on a ruled bottom line. Title, facts and tabs stay within about 100px on a desktop and
 * 120px on a phone.
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
  status,
  tabs,
  tabsEnd,
  testId,
  title,
  titleAside,
}: PageHeaderProps) {
  const picture = avatar ?? (icon ? (
    <IconAvatar label={`${title} icon`} size="md">
      {icon}
    </IconAvatar>
  ) : null);

  const hasTrail = Boolean(breadcrumbs?.length);
  const statusSlot = status ? (
    <div
      className={cn("flex shrink-0 items-center", !hasTrail && "sm:order-last")}
      data-testid={testId ? `${testId}-status-slot` : undefined}
    >
      {status}
    </div>
  ) : null;

  return (
    <header data-testid={testId}>
      {hasTrail ? (
        <div
          className="mb-2 flex items-center justify-between gap-3"
          data-testid={testId ? `${testId}-trail-row` : undefined}
        >
          <Breadcrumbs className="min-w-0" items={breadcrumbs ?? []} label={breadcrumbLabel} singleLine />
          {statusSlot}
        </div>
      ) : null}
      <div
        className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", tabs ? "pb-2" : "border-b border-border pb-3.5")}
        data-testid={testId ? `${testId}-title-row` : undefined}
      >
        {picture}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Heading data-testid={testId ? `${testId}-name` : undefined} level={1} variant="pageTitle">
              {title}
            </Heading>
            {titleAside}
          </div>
          {meta ? (
            // Each fact the page passes as its own element is set off from the one before by a dot.
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']"
              data-testid={testId ? `${testId}-meta` : undefined}
            >
              {meta}
            </div>
          ) : null}
          {description ? (
            <div className="mt-1 max-w-3xl space-y-1 text-sm text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {/* Without a trail the status ends the title row: beside the title on a phone, so it
            keeps the first line while actions wrap, and after the actions on a wider screen. */}
        {hasTrail ? null : statusSlot}
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

/**
 * A trail of links up to the current page, which is marked with `aria-current`. `singleLine`
 * keeps it to one line, shortening long names with an ellipsis, as on a page header's first line
 * beside its status chip.
 */
export function Breadcrumbs({
  className,
  items,
  label = "Breadcrumbs",
  singleLine = false,
}: {
  className?: string;
  items: Breadcrumb[];
  label?: string;
  singleLine?: boolean;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ol className={cn("flex items-center gap-2 text-sm text-muted-foreground", singleLine ? "flex-nowrap" : "flex-wrap")}>
        {items.map((breadcrumb, index) => {
          const isLast = index === items.length - 1;

          return (
            <Fragment
              key={`${breadcrumb.label}-${breadcrumb.href ?? index}`}
            >
              <li
                // On one line the trail's first step keeps its whole name and later ones shorten.
                className={singleLine ? (index === 0 ? "shrink-0" : "min-w-0 truncate") : undefined}
                title={singleLine ? breadcrumb.label : undefined}
              >
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
                  className="shrink-0 text-muted-foreground/70"
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

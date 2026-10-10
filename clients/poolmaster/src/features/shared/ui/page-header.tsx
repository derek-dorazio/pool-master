import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tile } from "./tile";

type Breadcrumb = {
  href?: string;
  label: string;
};

type PageHeaderProps = {
  actions?: ReactNode;
  breadcrumbLabel?: string;
  breadcrumbs?: Breadcrumb[];
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

export function PageHeader({
  actions,
  breadcrumbLabel = "Breadcrumbs",
  breadcrumbs,
  description,
  eyebrow,
  title,
}: PageHeaderProps) {
  return (
    <Tile padding="sm" radius="lg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
          {breadcrumbs?.length ? (
            <Breadcrumbs className="mt-3" items={breadcrumbs} label={breadcrumbLabel} />
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </Tile>
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

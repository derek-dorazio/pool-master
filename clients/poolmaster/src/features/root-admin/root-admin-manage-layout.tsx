import { Fragment } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { getManageBreadcrumbLabel } from './manage-navigation';

function buildBreadcrumbs(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  const manageIndex = segments.indexOf('manage');

  if (manageIndex === -1) {
    return [];
  }

  return segments.slice(manageIndex).map((segment, index, relevantSegments) => ({
    label: getManageBreadcrumbLabel(segment),
    href: `/${relevantSegments.slice(0, index + 1).join('/')}`,
  }));
}

export function RootAdminManageLayout() {
  const location = useLocation();
  const breadcrumbs = buildBreadcrumbs(location.pathname);

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-manage-layout"
    >
      <nav
        aria-label="Manage breadcrumbs"
        className="rounded-[1.5rem] border border-border bg-card px-5 py-4"
      >
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {breadcrumbs.map((breadcrumb, index) => {
            const isLast = index === breadcrumbs.length - 1;

            return (
              <Fragment key={breadcrumb.href}>
                <li>
                  {isLast ? (
                    <span className="font-medium text-foreground">
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
                  <li aria-hidden="true" className="text-muted-foreground/70">
                    /
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <Outlet />
    </section>
  );
}

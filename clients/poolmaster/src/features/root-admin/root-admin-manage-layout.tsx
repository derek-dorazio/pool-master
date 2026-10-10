import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AdminAreaLayout, Breadcrumbs, PageHeader } from "@/features/shared/ui";
import {
  buildManageMenuItems,
  getManageBreadcrumbLabel,
  MANAGE_LANDING_PATH,
} from "./manage-navigation";
import {
  ManageBreadcrumbContext,
  type ManageBreadcrumbContextValue,
} from "./manage-breadcrumb-context";

type BreadcrumbOverrides = Record<string, string>;

/**
 * The trail from the menu section down to the page. The area header and side menu already say
 * "Manage", so the trail starts at the section.
 */
function buildBreadcrumbs(pathname: string, overrides: BreadcrumbOverrides) {
  const segments = pathname.split("/").filter(Boolean);
  const manageIndex = segments.indexOf("manage");

  if (manageIndex === -1) {
    return [];
  }

  return segments
    .slice(manageIndex + 1)
    .map((segment, index, relevantSegments) => ({
      label: overrides[segment] ?? getManageBreadcrumbLabel(segment),
      href: `/manage/${relevantSegments.slice(0, index + 1).join("/")}`,
    }));
}

/** `/manage` itself, and the old Manage links, open the first section of the menu. */
export function ManageLandingRedirect() {
  return <Navigate replace to={MANAGE_LANDING_PATH} />;
}

/**
 * The root-admin area: its own header with the way out, a side menu of sections grouped as
 * Platform, Sports and Operations, and the page. A section page is titled by its menu entry; a
 * deeper page also shows the trail back up to its section.
 */
export function RootAdminManageLayout() {
  const location = useLocation();
  const [overrides, setOverrides] = useState<BreadcrumbOverrides>({});
  const [pageOwnsHeading, setPageOwnsHeading] = useState(false);

  const contextValue = useMemo<ManageBreadcrumbContextValue>(
    () => ({
      setOverride: (segment, label) => {
        setOverrides((current) => {
          if (!label) {
            if (!(segment in current)) {
              return current;
            }
            const next = { ...current };
            delete next[segment];
            return next;
          }

          if (current[segment] === label) {
            return current;
          }

          return { ...current, [segment]: label };
        });
      },
      setPageOwnsHeading,
    }),
    [],
  );

  const breadcrumbs = buildBreadcrumbs(location.pathname, overrides);
  const trail = breadcrumbs.length > 1 ? breadcrumbs : undefined;
  const pageTitle = breadcrumbs.at(-1)?.label ?? "Manage";

  return (
    <ManageBreadcrumbContext.Provider value={contextValue}>
      <AdminAreaLayout
        back={{ label: "Exit Manage", testId: "root-admin-manage-exit", to: "/" }}
        eyebrow="Root admin"
        icon={<ShieldCheck aria-hidden size={18} />}
        menuItems={buildManageMenuItems(location.pathname)}
        menuLabel="Manage"
        testId="root-admin-manage-layout"
        title="Manage"
      >
        <div className="space-y-6">
          {pageOwnsHeading ? (
            trail ? <Breadcrumbs items={trail} label="Manage breadcrumbs" /> : null
          ) : (
            <PageHeader
              breadcrumbLabel="Manage breadcrumbs"
              breadcrumbs={trail}
              title={pageTitle}
            />
          )}

          <Outlet />
        </div>
      </AdminAreaLayout>
    </ManageBreadcrumbContext.Provider>
  );
}

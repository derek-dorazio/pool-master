import { useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Breadcrumbs, ToolsArea } from "@/features/shared/ui";
import {
  buildManageSportTabs,
  buildManageTabs,
  getManageBreadcrumbLabel,
  MANAGE_LANDING_PATH,
} from "./manage-navigation";
import {
  ManageBreadcrumbContext,
  type ManageBreadcrumbContextValue,
} from "./manage-breadcrumb-context";

type BreadcrumbOverrides = Record<string, string>;

/**
 * The trail from the open tab down to the page. The tabs already say the tool, and under Sports
 * the second row says the sport, so the trail starts at the tool (or the sport's list) and shows
 * only on a page deeper than that.
 */
function buildBreadcrumbs(pathname: string, overrides: BreadcrumbOverrides) {
  const segments = pathname.split("/").filter(Boolean);
  const manageIndex = segments.indexOf("manage");

  if (manageIndex === -1) {
    return [];
  }

  const relevantSegments = segments.slice(manageIndex + 1);
  // Under `sports/<sport>/`, the sport tab already names the sport.
  const firstShown = relevantSegments[0] === "sports" ? 2 : 0;
  return relevantSegments
    .map((segment, index) => ({
      segment,
      label: overrides[segment] ?? getManageBreadcrumbLabel(relevantSegments, index),
      href: `/manage/${relevantSegments.slice(0, index + 1).join("/")}`,
    }))
    .slice(firstShown)
    .map(({ label, href }) => ({ label, href }));
}

/** `/manage` itself, and the old Manage links, open the first tab. */
export function ManageLandingRedirect() {
  return <Navigate replace to={MANAGE_LANDING_PATH} />;
}

/**
 * The root-admin area on the commissioner tools frame (#1620): the slim band with the way out,
 * Manage's tools as top tabs, one tab per sport under Sports, then the page, which opens with
 * its own `PageHeader`. A page deeper than its tab also shows the trail back up to it.
 */
export function RootAdminManageLayout() {
  const location = useLocation();
  const [overrides, setOverrides] = useState<BreadcrumbOverrides>({});

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
    }),
    [],
  );

  const breadcrumbs = buildBreadcrumbs(location.pathname, overrides);
  const sportTabs = buildManageSportTabs(location.pathname);

  return (
    <ManageBreadcrumbContext.Provider value={contextValue}>
      <ToolsArea
        back={{ label: "Exit Manage", testId: "root-admin-manage-exit", to: "/" }}
        eyebrow="Root admin"
        subTabs={sportTabs ? { items: sportTabs, label: "Sports" } : undefined}
        tabs={buildManageTabs(location.pathname)}
        tabsLabel="Manage"
        testId="root-admin-manage-layout"
        title="Manage"
      >
        <div className="space-y-4">
          {breadcrumbs.length > 1 ? <Breadcrumbs items={breadcrumbs} label="Manage breadcrumbs" /> : null}
          <Outlet />
        </div>
      </ToolsArea>
    </ManageBreadcrumbContext.Provider>
  );
}

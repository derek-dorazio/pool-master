import { useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Breadcrumbs, ToolsArea } from "@/features/shared/ui";
import {
  buildManageSubTabs,
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
 * The trail from the open tab down to the page, shown only on a page deeper than its tab. Under
 * `sports/<sport>/` it starts at the sport and skips the sport's old list pages, which now open
 * Sports; a League page draws its own trail in its header, so it gets none here.
 */
function buildBreadcrumbs(pathname: string, overrides: BreadcrumbOverrides) {
  const segments = pathname.split("/").filter(Boolean);
  const manageIndex = segments.indexOf("manage");

  if (manageIndex === -1) {
    return [];
  }

  const relevantSegments = segments.slice(manageIndex + 1);
  const underSport = relevantSegments[0] === "sports" && relevantSegments.length > 2;
  if (underSport && relevantSegments[2] === "leagues" && relevantSegments.length > 3 && relevantSegments[3] !== "new") {
    return [];
  }
  return relevantSegments
    .map((segment, index) => ({
      index,
      label: overrides[segment] ?? getManageBreadcrumbLabel(relevantSegments, index),
      href: `/manage/${relevantSegments.slice(0, index + 1).join("/")}`,
    }))
    .filter(({ index }) => !underSport || (index !== 0 && index !== 2))
    .map(({ label, href }) => ({ label, href }));
}

/** `/manage` itself, and the old Manage links, open the first tab. */
export function ManageLandingRedirect() {
  return <Navigate replace to={MANAGE_LANDING_PATH} />;
}

/**
 * The root-admin area on the commissioner tools frame (#1620): the slim band with the way out,
 * Manage's tools as top tabs, a second row under Notifications and Customers, then the page, which opens with
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
  const subTabs = buildManageSubTabs(location.pathname);

  return (
    <ManageBreadcrumbContext.Provider value={contextValue}>
      <ToolsArea
        back={{ label: "Exit Manage", testId: "root-admin-manage-exit", to: "/" }}
        eyebrow="Root admin"
        subTabs={subTabs ?? undefined}
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

import { useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { PageHeader } from "@/features/shared/ui";
import { getManageBreadcrumbLabel } from "./manage-navigation";
import {
  ManageBreadcrumbContext,
  type ManageBreadcrumbContextValue,
} from "./manage-breadcrumb-context";

type BreadcrumbOverrides = Record<string, string>;

function buildBreadcrumbs(pathname: string, overrides: BreadcrumbOverrides) {
  const segments = pathname.split("/").filter(Boolean);
  const manageIndex = segments.indexOf("manage");

  if (manageIndex === -1) {
    return [];
  }

  return segments
    .slice(manageIndex)
    .map((segment, index, relevantSegments) => ({
      label: overrides[segment] ?? getManageBreadcrumbLabel(segment),
      href: `/${relevantSegments.slice(0, index + 1).join("/")}`,
    }));
}

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
  const pageTitle = breadcrumbs.at(-1)?.label ?? "Manage";

  return (
    <ManageBreadcrumbContext.Provider value={contextValue}>
      <section className="space-y-6" data-testid="root-admin-manage-layout">
        <PageHeader
          breadcrumbLabel="Manage breadcrumbs"
          breadcrumbs={breadcrumbs}
          title={pageTitle}
        />

        <Outlet />
      </section>
    </ManageBreadcrumbContext.Provider>
  );
}

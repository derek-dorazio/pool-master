import { Outlet, useLocation } from "react-router-dom";
import { PageHeader } from "@/features/shared/ui";
import { getManageBreadcrumbLabel } from "./manage-navigation";

function buildBreadcrumbs(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const manageIndex = segments.indexOf("manage");

  if (manageIndex === -1) {
    return [];
  }

  return segments
    .slice(manageIndex)
    .map((segment, index, relevantSegments) => ({
      label: getManageBreadcrumbLabel(segment),
      href: `/${relevantSegments.slice(0, index + 1).join("/")}`,
    }));
}

export function RootAdminManageLayout() {
  const location = useLocation();
  const breadcrumbs = buildBreadcrumbs(location.pathname);
  const pageTitle = breadcrumbs.at(-1)?.label ?? "Manage";

  return (
    <section className="space-y-6" data-testid="root-admin-manage-layout">
      <PageHeader
        breadcrumbLabel="Manage breadcrumbs"
        breadcrumbs={breadcrumbs}
        title={pageTitle}
      />

      <Outlet />
    </section>
  );
}

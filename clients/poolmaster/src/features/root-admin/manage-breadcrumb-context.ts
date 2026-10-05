/**
 * The Manage breadcrumb override context and the hook child routes use to set it.
 *
 * Split out of `root-admin-manage-layout.tsx` for
 * `react-refresh/only-export-components` (#345 Phase 0, from #167): that module
 * exports the layout component, so the hook exported beside it broke Fast Refresh
 * for the whole Manage layout. The context object moved here too -- it has to
 * live in a module both the provider and the consumers import, or they would read
 * two different contexts.
 *
 * plans/124 §6.1 is the behaviour: a child route swaps a dynamic path segment
 * (a `:eventId` / `:participantId` UUID) for the loaded entity's name. The layout
 * only knows static labels; the child page knows the name.
 */
import { createContext, useContext, useEffect } from "react";

export type ManageBreadcrumbContextValue = {
  setOverride: (segment: string, label: string | null | undefined) => void;
};

export const ManageBreadcrumbContext =
  createContext<ManageBreadcrumbContextValue | null>(null);

export function useManageBreadcrumbOverride(
  segment: string | undefined,
  label: string | null | undefined,
) {
  const context = useContext(ManageBreadcrumbContext);

  useEffect(() => {
    if (!context || !segment) {
      return;
    }

    context.setOverride(segment, label);

    return () => {
      context.setOverride(segment, null);
    };
  }, [context, segment, label]);
}

import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminListLeagues, type AdminListLeaguesResponses } from "@/lib/api";
import { buildLeaguePath } from "@/features/leagues/league-routing";
import {
  ManagementListPage,
  StatusBadge,
} from "@/features/shared/ui";
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

type ManagedLeague = AdminListLeaguesResponses[200]["leagues"][number];
const columnHelper = createColumnHelper<ManagedLeague>();

export function RootAdminManageLeaguesPage() {
  const leaguesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageLeagues,
    queryFn: async (): Promise<ManagedLeague[]> => {
      const response = await adminListLeagues({
        query: {},
      });

      if (!response.data?.leagues) {
        throw (
          response.error ??
          new Error("League management response is missing data.")
        );
      }

      return response.data.leagues;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "League",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-primary">{row.original.name}</div>
            {row.original.description ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {row.original.description}
              </div>
            ) : null}
          </div>
        ),
      }),
      columnHelper.accessor("leagueCode", {
        header: "Code",
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor(
        (league) => (league.isActive ? "Active" : "Inactive"),
        {
          id: "lifecycle",
          header: "Lifecycle",
          cell: ({ getValue }) => {
            const isActive = getValue() === "Active";

            return (
              <StatusBadge tone={isActive ? "active" : "inactive"}>
                {getValue()}
              </StatusBadge>
            );
          },
        },
      ),
      columnHelper.accessor((league) => String(league.memberCount), {
        id: "memberCount",
        header: "Members",
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.memberCount}
          </span>
        ),
      }),
      columnHelper.accessor((league) => String(league.activeContestCount), {
        id: "activeContestCount",
        header: "Active contests",
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.activeContestCount}
          </span>
        ),
      }),
    ],
    [],
  );

  return (
    <ManagementListPage
      columns={columns}
      data={leaguesQuery.data ?? []}
      emptyMessage="No leagues matched the current filters."
      errorBody={extractErrorMessage(
        leaguesQuery.error,
        { fallback: "We could not load leagues right now." },
      )}
      getRowId={(league) => league.id}
      getRowLink={(league) => buildLeaguePath(league.leagueCode)}
      loadingBody="Loading leagues..."
      rowTestId={(league) => `root-admin-manage-leagues-link-${league.id}`}
      state={
        leaguesQuery.isLoading
          ? "loading"
          : leaguesQuery.isError
            ? "error"
            : "ready"
      }
      testId="root-admin-manage-leagues-page"
    />
  );
}

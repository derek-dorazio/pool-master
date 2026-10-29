import { createColumnHelper } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isPlatformSearchTerm, PLATFORM_SEARCH_MIN_LENGTH } from "@poolmaster/shared/domain";
import { listLeagues, type LeagueDto } from "@/lib/api";
import { buildLeaguePath } from "@/features/leagues/league-routing";
import { LEAGUE_PLAN_LABEL } from "@/features/plans/plan-labels";
import { ExtendRunningGifts } from "@/features/plans/extend-running-gifts";
import {
  ManagementListPage,
  StatusBadge,
  Tile,
  formatDateDisplay,
  useDisplayPreferences,
} from "@/features/shared/ui";
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { MANAGE_LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from './manage-navigation';

const columnHelper = createColumnHelper<LeagueDto>();

export function RootAdminManageLeaguesPage() {
  const displayPreferences = useDisplayPreferences();
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const canSearch = isPlatformSearchTerm(term);
  const leaguesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageLeaguesSearch(term),
    enabled: canSearch,
    // The search box sits in the grid: keeping the last rows keeps the grid, and the box, mounted
    // while the next term loads.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<LeagueDto[]> => {
      // #202 — one league list, scope as a parameter. `scope: 'all'` is access rule A1's
      // unscoped read, which the route permits to root admins only; this page was the sole
      // caller of the `adminListLeagues` half. It takes a search (#1180): every league is too
      // many to read.
      const response = await listLeagues({
        query: { scope: "all", search: term },
      });

      if (!response.data?.leagues) {
        throwApiError(response.error, "League management response is missing data.");
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
      columnHelper.accessor((league) => LEAGUE_PLAN_LABEL[league.planEntitlements.plan], {
        id: "plan",
        header: "Plan",
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor((league) => formatDateDisplay(league.planRenewsAt, displayPreferences), {
        id: "planRenewsAt",
        header: "Preview ends",
        cell: ({ getValue }) => (
          <span className="text-foreground">{getValue()}</span>
        ),
      }),
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
    [displayPreferences],
  );

  return (
    <div className="space-y-4">
      <Tile>
        <ExtendRunningGifts />
      </Tile>
      <ManagementListPage
        columns={columns}
        // An error shows in the grid rather than in place of it, so the search box stays to retry.
        data={canSearch && !leaguesQuery.isError ? (leaguesQuery.data ?? []) : []}
        emptyMessage={
          !canSearch
            ? `Type at least ${PLATFORM_SEARCH_MIN_LENGTH} characters of a league's name to find it.`
            : leaguesQuery.isError
              ? extractErrorMessage(leaguesQuery.error, { fallback: "We could not load leagues right now." })
              : leaguesQuery.isFetching
                ? "Searching leagues..."
                : "No leagues matched the current filters."
        }
        getRowId={(league) => league.id}
        getRowLink={(league) => buildLeaguePath(league.leagueCode)}
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(league) => `root-admin-manage-leagues-link-${league.id}`}
        search={{ label: "Find a league", testId: "root-admin-manage-leagues-search", onChange: setSearch }}
        tableTestId="root-admin-manage-leagues-table"
        testId="root-admin-manage-leagues-page"
      />
    </div>
  );
}

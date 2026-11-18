import { ActiveStatusBadge } from "./active-status-badge";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isPlatformSearchTerm, type LeaguePlan, LeaguePlanOrder, PLATFORM_SEARCH_MIN_LENGTH } from "@poolmaster/shared/domain";
import { listLeagues, type LeagueDto } from "@/lib/api";
import { buildLeaguePath } from "@/features/leagues/league-routing";
import { LEAGUE_PLAN_LABEL } from "@/features/plans/plan-labels";
import { ExtendRunningGifts } from "@/features/plans/extend-running-gifts";
import {
  DataGrid,
  ErrorState,
  Input,
  PageHeader,
  SectionCard,
} from "@/features/shared/ui";
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { MANAGE_LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from './manage-navigation';

const columnHelper = createColumnHelper<LeagueDto>();

const leaguePlanLabel = (plan: LeaguePlan) => LEAGUE_PLAN_LABEL[plan];

export function RootAdminManageLeaguesPage() {
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const canSearch = isPlatformSearchTerm(term);
  const leaguesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageLeaguesSearch(term),
    enabled: canSearch,
    // Keeping the last rows keeps the grid steady while the next term loads.
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
        meta: { info: "The league's name.", type: { kind: "text" } },
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
        meta: { info: "The league's short code, used in its web address.", type: { kind: "text" } },
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor(
        (league) => (league.isActive ? "Active" : "Inactive"),
        {
          id: "lifecycle",
          header: "Lifecycle",
          meta: { info: "Whether the league is active.", type: { kind: "enum" } },
          cell: ({ getValue }) => <ActiveStatusBadge status={getValue()} />,
        },
      ),
      columnHelper.accessor((league) => league.planEntitlements.plan, {
        id: "plan",
        header: "Plan",
        meta: { info: "The plan the league is on, which decides the features it gets.", type: { kind: "enum", order: LeaguePlanOrder, label: leaguePlanLabel } },
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{LEAGUE_PLAN_LABEL[getValue()]}</span>
        ),
      }),
      columnHelper.accessor("planRenewsAt", {
        id: "planRenewsAt",
        header: "Preview ends",
        meta: { info: "When the league's Premium preview period ends, if it has one.", type: { kind: "date", direction: "both" } },
      }),
      columnHelper.accessor("memberCount", {
        id: "memberCount",
        header: "Members",
        meta: { info: "How many members the league has.", type: { kind: "number" } },
      }),
      columnHelper.accessor("activeContestCount", {
        id: "activeContestCount",
        header: "Active contests",
        meta: { info: "How many of the league's contests are not yet final.", type: { kind: "number" } },
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-manage-leagues-page">
      <PageHeader
        search={(
          <Input
            aria-label="Find a league"
            data-testid="root-admin-manage-leagues-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a league"
            type="search"
            value={search}
          />
        )}
        testId="root-admin-manage-leagues-header"
        title="Leagues"
      />
      {leaguesQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(leaguesQuery.error, { fallback: "We could not load leagues right now." })}
          onRetry={() => void leaguesQuery.refetch()}
          testId="root-admin-manage-leagues-error"
        />
      ) : (
        <DataGrid
          columns={columns}
          // The server searched; the grid narrows the last rows as the term grows.
          data={canSearch ? (leaguesQuery.data ?? []) : []}
          emptyMessage={
            !canSearch
              ? `Type at least ${PLATFORM_SEARCH_MIN_LENGTH} characters of a league's name to find it.`
              : leaguesQuery.isFetching
                ? "Searching leagues..."
                : "No leagues matched the current filters."
          }
          getRowId={(league) => league.id}
          getRowLink={(league) => buildLeaguePath(league.leagueCode)}
          pageSize={MANAGE_LIST_PAGE_SIZE}
          rowTestId={(league) => `root-admin-manage-leagues-link-${league.id}`}
          searchTerm={search}
          tableTestId="root-admin-manage-leagues-table"
        />
      )}
      <SectionCard padded title="Premium preview periods">
        <ExtendRunningGifts />
      </SectionCard>
    </section>
  );
}

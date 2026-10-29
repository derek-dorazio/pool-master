import { createColumnHelper } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isPlatformSearchTerm, PLATFORM_SEARCH_MIN_LENGTH } from "@poolmaster/shared/domain";
import { listUsers, type UserDto } from "@/lib/api";
import { extractErrorMessage, throwApiError } from "@/lib/errors";
import {
  DataGridPage,
  StatusBadge,
} from "@/features/shared/ui";
import { QueryKeys } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { buildManageUserPath, MANAGE_LIST_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from './manage-navigation';

// #202 step 3.4 — the canonical named component, not an index into the response map.
type RootAdminUser = UserDto;
const columnHelper = createColumnHelper<RootAdminUser>();

function buildUserDisplayName(user: RootAdminUser) {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  return fullName.length > 0 ? fullName : user.username;
}

export function RootAdminManageUsersPage() {
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const canSearch = isPlatformSearchTerm(term);
  const usersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageUsersSearch(term),
    enabled: canSearch,
    // The search box sits in the grid: keeping the last rows keeps the grid, and the box, mounted
    // while the next term loads.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // No paging (§16), and every user is too many to read (#1180): the server searches.
      const response = await listUsers({ query: { search: term } });

      if (!response.data) {
        throwApiError(response.error, "User list response is missing data.");
      }

      return response.data;
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (user) => `${buildUserDisplayName(user)} ${user.username}`,
        {
          id: "username",
          header: "User",
          cell: ({ row }) => (
            <div>
              <div className="font-medium text-primary">
                {buildUserDisplayName(row.original)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                @{row.original.username}
              </div>
            </div>
          ),
        },
      ),
      columnHelper.accessor("email", {
        header: "Email",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor((user) => (user.isActive ? "Active" : "Inactive"), {
        id: "account",
        header: "Account",
        cell: ({ getValue }) => {
          const isActive = getValue() === "Active";

          return (
            <StatusBadge tone={isActive ? "active" : "inactive"}>
              {getValue()}
            </StatusBadge>
          );
        },
      }),
      columnHelper.accessor((user) => (user.isRootAdmin ? "Yes" : "No"), {
        id: "rootAdmin",
        header: "Root admin",
        cell: ({ getValue }) => {
          const isRootAdmin = getValue() === "Yes";

          return (
            <StatusBadge tone={isRootAdmin ? "info" : "neutral"}>
              {getValue()}
            </StatusBadge>
          );
        },
      }),
    ],
    [],
  );

  return (
    <DataGridPage
      columns={columns}
      // An error shows in the grid rather than in place of it, so the search box stays to retry.
      data={canSearch && !usersQuery.isError ? (usersQuery.data?.users ?? []) : []}
      emptyMessage={
        !canSearch
          ? `Type at least ${PLATFORM_SEARCH_MIN_LENGTH} characters to find a user.`
          : usersQuery.isError
            ? extractErrorMessage(usersQuery.error, { fallback: "We could not load users right now." })
            : usersQuery.isFetching
              ? "Searching users..."
              : "No users matched the current filters."
      }
      getRowId={(user) => user.id}
      getRowLink={(user) => buildManageUserPath(user.id)}
      pageSize={MANAGE_LIST_PAGE_SIZE}
      rowTestId={(user) => `root-admin-manage-user-row-${user.id}`}
      search={{ label: "Find a user", testId: "root-admin-manage-users-search", onChange: setSearch }}
      tableTestId="root-admin-manage-users-table"
      testId="root-admin-manage-users-page"
    />
  );
}

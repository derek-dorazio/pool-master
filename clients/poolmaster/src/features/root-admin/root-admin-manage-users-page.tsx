import { ActiveStatusBadge } from "./active-status-badge";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isPlatformSearchTerm, PLATFORM_SEARCH_MIN_LENGTH } from "@poolmaster/shared/domain";
import { listUsers, type UserDto } from "@/lib/api";
import { extractErrorMessage, throwApiError } from "@/lib/errors";
import {
  DataGrid,
  ErrorState,
  Input,
  PageHeader,
  StatusBadge,
} from "@/features/shared/ui";
import { QueryKeys } from '@/lib/query-keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { buildManageUserPath, SEARCH_DEBOUNCE_MS } from './manage-navigation';

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
    // Keeping the last rows keeps the grid steady while the next term loads.
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
          meta: { info: "The user's name and username.", type: { kind: "text" } },
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
        meta: { info: "The email address the user signs in with.", type: { kind: "text" } },
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor((user) => (user.isActive ? "Active" : "Inactive"), {
        id: "account",
        header: "Account",
        meta: { info: "Whether the user's account is active.", type: { kind: "enum" } },
        cell: ({ getValue }) => <ActiveStatusBadge status={getValue()} />,
      }),
      columnHelper.accessor("isRootAdmin", {
        id: "rootAdmin",
        header: "Root admin",
        meta: { info: "Whether the user can use the root admin pages.", type: { kind: "boolean" } },
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() ? "info" : "neutral"}>
            {getValue() ? "Yes" : "No"}
          </StatusBadge>
        ),
      }),
    ],
    [],
  );

  return (
    <section className="space-y-6" data-testid="root-admin-manage-users-page">
      <PageHeader
        search={(
          <Input
            aria-label="Find a user"
            data-testid="root-admin-manage-users-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a user"
            type="search"
            value={search}
          />
        )}
        testId="root-admin-manage-users-header"
        title="Users"
      />
      {usersQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(usersQuery.error, { fallback: "We could not load users right now." })}
          onRetry={() => void usersQuery.refetch()}
          testId="root-admin-manage-users-error"
        />
      ) : (
        <DataGrid
          columns={columns}
          // The server searched; the grid narrows the last rows as the term grows.
          data={canSearch ? (usersQuery.data?.users ?? []) : []}
          emptyMessage={
            !canSearch
              ? `Type at least ${PLATFORM_SEARCH_MIN_LENGTH} characters to find a user.`
              : usersQuery.isFetching
                ? "Searching users..."
                : "No users matched the current filters."
          }
          getRowId={(user) => user.id}
          getRowLink={(user) => buildManageUserPath(user.id)}
          rowTestId={(user) => `root-admin-manage-user-row-${user.id}`}
          searchTerm={search}
          tableTestId="root-admin-manage-users-table"
        />
      )}
    </section>
  );
}

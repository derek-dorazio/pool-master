import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminListUsers, type AdminListUsersResponses } from "@/lib/api";
import {
  DataGrid,
  ErrorState,
  LoadingState,
  StatusBadge,
  Tile,
} from "@/features/shared/ui";

type RootAdminUser = AdminListUsersResponses[200]["items"][number];
const columnHelper = createColumnHelper<RootAdminUser>();

function extractAdminError(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const candidate = error as {
    error?: { code?: unknown; message?: unknown };
    message?: unknown;
  };

  if (
    typeof candidate.error?.code === "string" &&
    typeof candidate.error?.message === "string"
  ) {
    return `${candidate.error.code}: ${candidate.error.message}`;
  }

  if (typeof candidate.error?.message === "string") {
    return candidate.error.message;
  }

  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  return fallback;
}

function buildUserDisplayName(user: RootAdminUser) {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  return fullName.length > 0 ? fullName : user.username;
}

export function RootAdminManageUsersPage() {
  const usersQuery = useQuery({
    queryKey: ["poolmaster", "manage", "users"],
    queryFn: async () => {
      const response = await adminListUsers({
        query: {
          page: 1,
          pageSize: 100,
        },
      });

      if (!response.data) {
        throw (
          response.error ?? new Error("User list response is missing data.")
        );
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
    <section className="space-y-6" data-testid="root-admin-manage-users-page">
      <Tile>
        {usersQuery.isLoading ? (
          <LoadingState body="Loading users..." />
        ) : usersQuery.isError ? (
          <ErrorState
            body={extractAdminError(
              usersQuery.error,
              "We could not load users right now.",
            )}
          />
        ) : (
          <DataGrid
            columns={columns}
            data={usersQuery.data?.items ?? []}
            emptyMessage="No users matched the current filters."
            getRowId={(user) => user.id}
            getRowLink={(user) => `/users/${user.id}`}
            rowTestId={(user) => `root-admin-manage-user-row-${user.id}`}
          />
        )}
      </Tile>
    </section>
  );
}

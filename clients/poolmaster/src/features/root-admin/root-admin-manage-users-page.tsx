import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminListUsers, type AdminListUsersResponses } from "@/lib/api";
import {
  DataGridPage,
  StatusBadge,
} from "@/features/shared/ui";

type RootAdminUser = AdminListUsersResponses[200]["items"][number];
const columnHelper = createColumnHelper<RootAdminUser>();

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
    <DataGridPage
      columns={columns}
      data={usersQuery.data?.items ?? []}
      emptyMessage="No users matched the current filters."
      error={usersQuery.error}
      errorBody="We could not load users right now."
      getRowId={(user) => user.id}
      getRowLink={(user) => `/users/${user.id}`}
      loadingBody="Loading users..."
      rowTestId={(user) => `root-admin-manage-user-row-${user.id}`}
      state={
        usersQuery.isLoading
          ? "loading"
          : usersQuery.isError
            ? "error"
            : "ready"
      }
      testId="root-admin-manage-users-page"
    />
  );
}

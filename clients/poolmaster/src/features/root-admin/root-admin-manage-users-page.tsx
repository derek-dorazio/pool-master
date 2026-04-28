import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminListUsers, type AdminListUsersResponses } from '@/lib/api';
import { AdminDataGrid } from './admin-data-grid';

type RootAdminUser = AdminListUsersResponses[200]['items'][number];
const columnHelper = createColumnHelper<RootAdminUser>();

function extractAdminError(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    error?: { code?: unknown; message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.code === 'string' && typeof candidate.error?.message === 'string') {
    return `${candidate.error.code}: ${candidate.error.message}`;
  }

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
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
    queryKey: ['poolmaster', 'manage', 'users'],
    queryFn: async () => {
      const response = await adminListUsers({
        query: {
          page: 1,
          pageSize: 100,
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('User list response is missing data.');
      }

      return response.data;
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (user) => `${buildUserDisplayName(user)} ${user.username}`,
        {
          id: 'username',
          header: 'User',
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
      columnHelper.accessor('email', {
        header: 'Email',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor((user) => (user.isActive ? 'Active' : 'Inactive'), {
        id: 'account',
        header: 'Account',
        cell: ({ getValue }) => {
          const isActive = getValue() === 'Active';

          return (
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                isActive
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-border bg-background text-muted-foreground'
              }`}
            >
              {getValue()}
            </span>
          );
        },
      }),
      columnHelper.accessor((user) => (user.isRootAdmin ? 'Yes' : 'No'), {
        id: 'rootAdmin',
        header: 'Root admin',
        cell: ({ getValue }) => {
          const isRootAdmin = getValue() === 'Yes';

          return (
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                isRootAdmin
                  ? 'border-sky-300 bg-sky-50 text-sky-900'
                  : 'border-border bg-background text-muted-foreground'
              }`}
            >
              {getValue()}
            </span>
          );
        },
      }),
    ],
    [],
  );

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-manage-users-page"
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Manage
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Users
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Search user accounts, review root-admin and lifecycle status, and open
          user pages for account actions.
        </p>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              User directory
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Filter by the columns below and open a user page from the name column.
            </p>
          </div>
        </div>

        {usersQuery.isLoading ? (
          <p className="mt-5 text-sm text-muted-foreground">Loading users...</p>
        ) : usersQuery.isError ? (
          <p className="mt-5 text-sm text-rose-700">
            {extractAdminError(
              usersQuery.error,
              'We could not load users right now.',
            )}
          </p>
        ) : (
          <div className="mt-5">
            <AdminDataGrid
              columns={columns}
              data={usersQuery.data?.items ?? []}
              emptyMessage="No users matched the current filters."
              getRowId={(user) => user.id}
              getRowLink={(user) => `/users/${user.id}`}
              rowTestId={(user) => `root-admin-manage-user-row-${user.id}`}
            />
          </div>
        )}
      </section>
    </section>
  );
}

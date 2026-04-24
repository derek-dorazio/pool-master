import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adminListUsers, type AdminListUsersResponses } from '@/lib/api';
import { useLogger } from '@/lib/logger';

type RootAdminUser = AdminListUsersResponses[200]['items'][number];

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
  const logger = useLogger().child({
    component: 'root-admin-manage-users-page',
  });
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(searchDraft);
  const trimmedSearch = deferredSearch.trim();

  useEffect(() => {
    setPage(1);
  }, [trimmedSearch]);

  const usersQuery = useQuery({
    queryKey: ['poolmaster', 'manage', 'users', trimmedSearch, page],
    queryFn: async () => {
      const response = await adminListUsers({
        query: {
          search: trimmedSearch.length > 0 ? trimmedSearch : undefined,
          page,
          pageSize: 25,
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('User list response is missing data.');
      }

      return response.data;
    },
  });

  const totalPages = usersQuery.data?.totalPages ?? 1;

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
          the canonical user page for account-scope actions. Role elevation,
          password reset, inactivation, and delete all live on `/users/:userId`,
          not on this list.
        </p>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              User directory
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Search by email, username, first name, or last name, then move
              into the canonical user page to act.
            </p>
          </div>

          <label className="text-sm text-muted-foreground lg:min-w-[22rem]">
            <span className="mb-2 block font-medium text-foreground">
              Search users
            </span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-manage-users-search"
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search by email, username, first, or last name"
              value={searchDraft}
            />
          </label>
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
          <>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Root admin</th>
                    <th className="px-4 py-3 font-medium text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {usersQuery.data && usersQuery.data.items.length > 0 ? (
                    usersQuery.data.items.map((user) => (
                      <tr
                        className="border-b border-border/70 align-top text-foreground"
                        data-testid={`root-admin-manage-user-row-${user.id}`}
                        key={user.id}
                      >
                        <td className="px-4 py-4">
                          <div className="font-medium text-foreground">
                            {buildUserDisplayName(user)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            @{user.username}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">
                          {user.email}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                              user.isActive
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                : 'border-border bg-background text-muted-foreground'
                            }`}
                          >
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                              user.isRootAdmin
                                ? 'border-sky-300 bg-sky-50 text-sky-900'
                                : 'border-border bg-background text-muted-foreground'
                            }`}
                          >
                            {user.isRootAdmin ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Link
                            className="inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
                            data-testid={`root-admin-manage-user-link-${user.id}`}
                            onClick={() =>
                              logger.info(
                                {
                                  action: 'rootAdmin.manageUsers.openUser',
                                  data: { userId: user.id },
                                },
                                'Opening canonical user page from /manage/users',
                              )
                            }
                            to={`/users/${user.id}`}
                          >
                            Open user page
                          </Link>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                        No users matched the current search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
              <p>
                Page {usersQuery.data?.page ?? 1} of {totalPages}
                {' · '}
                {usersQuery.data?.total ?? 0} users
              </p>
              <div className="flex gap-2">
                <button
                  className="rounded-full border border-border px-3 py-1 font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="root-admin-manage-users-prev"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="rounded-full border border-border px-3 py-1 font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="root-admin-manage-users-next"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

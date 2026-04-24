import { useDeferredValue, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminListUsers,
  adminSetUserRootAdmin,
  type AdminListUsersResponses,
} from '@/lib/api';
import { useLogger } from '@/lib/logger';
import { useAuth } from '@/features/auth/auth-provider';

type RootAdminUser = AdminListUsersResponses[200]['items'][number];

interface PendingRoleChange {
  user: RootAdminUser;
  nextValue: boolean;
}

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

export function RootAdminUsersPanel() {
  const auth = useAuth();
  const logger = useLogger().child({
    component: 'root-admin-users-panel',
  });
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState('');
  const [page, setPage] = useState(1);
  const [pendingRoleChange, setPendingRoleChange] = useState<PendingRoleChange | null>(null);
  const [reason, setReason] = useState('');
  const deferredSearch = useDeferredValue(searchDraft);
  const trimmedSearch = deferredSearch.trim();

  useEffect(() => {
    setPage(1);
  }, [trimmedSearch]);

  const usersQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'users', trimmedSearch, page],
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

  const setRootAdminMutation = useMutation({
    mutationFn: async (input: { userId: string; isRootAdmin: boolean; reason?: string }) => {
      const response = await adminSetUserRootAdmin({
        path: {
          userId: input.userId,
        },
        body: {
          isRootAdmin: input.isRootAdmin,
          reason: input.reason,
        },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('Root-admin role change response is missing success confirmation.');
      }

      return response.data;
    },
    onSuccess: async (_result, variables) => {
      logger.info(
        {
          action: 'rootAdmin.users.roleChanged',
          data: {
            userId: variables.userId,
            isRootAdmin: variables.isRootAdmin,
          },
        },
        'Updated root-admin role from /manage',
      );
      setPendingRoleChange(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'users'] });
    },
    onError: (error) => {
      logger.warn(
        {
          action: 'rootAdmin.users.roleChangeFailed',
          err: error instanceof Error ? error : undefined,
        },
        'Root-admin role change failed',
      );
    },
  });

  const totalPages = usersQuery.data?.totalPages ?? 1;
  const currentUserId = auth.user?.id;

  function openRoleChange(user: RootAdminUser, nextValue: boolean) {
    setPendingRoleChange({ user, nextValue });
    setReason('');
    setRootAdminMutation.reset();
  }

  function closeRoleChange() {
    setPendingRoleChange(null);
    setReason('');
    setRootAdminMutation.reset();
  }

  return (
    <section className="rounded-[2rem] border border-border bg-card p-6" data-testid="root-admin-users-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Root-admin users</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Root admin is an internal system role. It cannot be granted through registration or invitations.
            Only an existing root admin can grant it here, and at least one root admin must always remain.
          </p>
        </div>

        <label className="text-sm text-muted-foreground lg:min-w-[22rem]">
          <span className="mb-2 block font-medium text-foreground">Search users</span>
          <input
            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
            data-testid="root-admin-users-search"
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
          {extractAdminError(usersQuery.error, 'We could not load users right now.')}
        </p>
      ) : (
        <>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Active</th>
                  <th className="px-4 py-3 font-medium">Root admin</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data && usersQuery.data.items.length > 0 ? (
                  usersQuery.data.items.map((user) => {
                    const isSelf = user.id === currentUserId;
                    return (
                      <tr
                        className="border-b border-border/70 align-top text-foreground"
                        data-testid={`root-admin-user-row-${user.id}`}
                        key={user.id}
                      >
                        <td className="px-4 py-4">
                          <div className="font-medium text-foreground">{buildUserDisplayName(user)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">@{user.username}</div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{user.email}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${user.isActive ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-border bg-background text-muted-foreground'}`}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${user.isRootAdmin ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-border bg-background text-muted-foreground'}`}>
                            {user.isRootAdmin ? 'Yes' : 'No'}
                          </span>
                          {isSelf ? (
                            <span className="ml-2 text-xs text-muted-foreground">You</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-right">
                          {user.isRootAdmin ? (
                            <button
                              className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
                              data-testid={`root-admin-user-demote-${user.id}`}
                              disabled={isSelf}
                              onClick={() => openRoleChange(user, false)}
                              type="button"
                            >
                              Demote
                            </button>
                          ) : (
                            <button
                              className="rounded-2xl bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                              data-testid={`root-admin-user-promote-${user.id}`}
                              onClick={() => openRoleChange(user, true)}
                              type="button"
                            >
                              Promote
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
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
                data-testid="root-admin-users-prev"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Previous
              </button>
              <button
                className="rounded-full border border-border px-3 py-1 font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="root-admin-users-next"
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

      {pendingRoleChange ? (
        <div className="mt-5 rounded-[1.5rem] border border-border bg-background p-5" data-testid="root-admin-user-confirmation">
          <h4 className="text-lg font-semibold text-foreground">
            {pendingRoleChange.nextValue ? 'Promote user to root admin' : 'Demote root admin'}
          </h4>
          <p className="mt-2 text-sm text-muted-foreground">
            {buildUserDisplayName(pendingRoleChange.user)} ({pendingRoleChange.user.email})
          </p>
          <label className="mt-4 block text-sm text-muted-foreground">
            <span className="mb-2 block font-medium text-foreground">Reason (optional)</span>
            <textarea
              className="min-h-[96px] w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-user-reason"
              onChange={(event) => setReason(event.target.value)}
              placeholder="Document why this root-admin change is needed."
              value={reason}
            />
          </label>

          {setRootAdminMutation.isError ? (
            <p className="mt-3 text-sm text-rose-700" data-testid="root-admin-user-error">
              {extractAdminError(
                setRootAdminMutation.error,
                'We could not update this root-admin role right now.',
              )}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="root-admin-user-confirm"
              disabled={setRootAdminMutation.isPending}
              onClick={() => setRootAdminMutation.mutate({
                userId: pendingRoleChange.user.id,
                isRootAdmin: pendingRoleChange.nextValue,
                reason: reason.trim().length > 0 ? reason.trim() : undefined,
              })}
              type="button"
            >
              {setRootAdminMutation.isPending
                ? 'Saving...'
                : pendingRoleChange.nextValue
                  ? 'Confirm promote'
                  : 'Confirm demote'}
            </button>
            <button
              className="rounded-2xl border border-border px-5 py-3 text-sm font-medium text-foreground transition hover:bg-card"
              data-testid="root-admin-user-cancel"
              onClick={closeRoleChange}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

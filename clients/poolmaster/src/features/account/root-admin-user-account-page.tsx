import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  adminDeleteUser,
  adminDisableUser,
  adminEnableUser,
  adminGetUserDetail,
  adminResetUserPassword,
  adminSetUserRootAdmin,
  type AdminGetUserDetailResponses,
} from '@/lib/api';
import { useLogger } from '@/lib/logger';
import { buildLeaguePath, buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import { formatUserName } from './user-name';

type RootAdminViewedUser = AdminGetUserDetailResponses[200];
type ActiveDialog = 'role' | 'reset-password' | 'lifecycle' | 'delete' | null;

function formatMemberSince(createdAt?: string, dateFormat?: 'MDY' | 'DMY' | 'YMD') {
  if (!createdAt) {
    return 'Unknown';
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear());

  if (dateFormat === 'DMY') {
    return `${day}/${month}/${year}`;
  }

  if (dateFormat === 'YMD') {
    return `${year}-${month}-${day}`;
  }

  return `${month}/${day}/${year}`;
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

type DeleteDependencyDetails = {
  dependencyType?: unknown;
  team?: {
    id?: unknown;
    name?: unknown;
  };
  league?: {
    leagueCode?: unknown;
    name?: unknown;
  };
};

function extractDeleteDependencyDetails(error: unknown): DeleteDependencyDetails | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as {
    error?: {
      code?: unknown;
      details?: unknown;
    };
  };

  if (
    candidate.error?.code !== 'ACCOUNT_DELETE_DEPENDENCIES_EXIST' ||
    !candidate.error.details ||
    typeof candidate.error.details !== 'object'
  ) {
    return null;
  }

  return candidate.error.details as DeleteDependencyDetails;
}

function formatLeagueLinkText(league: { leagueCode?: unknown; name?: unknown }) {
  if (typeof league.name !== 'string' || typeof league.leagueCode !== 'string') {
    return null;
  }

  return `${league.name}-${league.leagueCode}`;
}

function AccountDeleteDependencyMessage({ error }: { error: unknown }) {
  const details = extractDeleteDependencyDetails(error);
  const team = details?.team;
  const league = details?.league;

  if (
    !details ||
    typeof league?.leagueCode !== 'string' ||
    typeof league.name !== 'string'
  ) {
    return <>{extractAdminError(error, 'We could not delete this account.')}</>;
  }

  const leagueLinkText = formatLeagueLinkText(league);

  if (
    typeof team?.id === 'string' &&
    typeof team.name === 'string' &&
    leagueLinkText
  ) {
    const relationship =
      details.dependencyType === 'TEAM_OWNER' ? 'an owner of team' : 'a member of team';

    return (
      <>
        Account cannot be deleted because it&apos;s still {relationship}{' '}
        <Link
          className="font-semibold underline"
          to={buildLeagueTeamHomePath(league.leagueCode, team.id)}
        >
          {team.name}
        </Link>{' '}
        in league{' '}
        <Link className="font-semibold underline" to={buildLeaguePath(league.leagueCode)}>
          {leagueLinkText}
        </Link>
        .
      </>
    );
  }

  return (
    <>
      Account cannot be deleted because it still belongs to league{' '}
      <Link className="font-semibold underline" to={buildLeaguePath(league.leagueCode)}>
        {leagueLinkText}
      </Link>
      .
    </>
  );
}

function UserActionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={`${testId}-description`}
          className="fixed left-1/2 top-1/2 z-50 w-[min(96vw,40rem)] -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
          data-testid={testId}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </Dialog.Title>
              <Dialog.Description
                className="mt-2 text-sm text-muted-foreground"
                id={`${testId}-description`}
              >
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label={`Close ${title}`}
                className="rounded-full border border-border p-2 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                type="button"
              >
                ×
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RootAdminUserAccountPage({ userId }: { userId: string }) {
  const logger = useLogger().child({
    feature: 'root-admin-user-account-page',
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [reason, setReason] = useState('');
  const [deleteEmailConfirmation, setDeleteEmailConfirmation] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const userDetailQuery = useQuery({
    queryKey: ['poolmaster', 'admin', 'user-detail', userId],
    queryFn: async () => {
      const response = await adminGetUserDetail({
        path: { userId },
      });

      if (!response.data) {
        throw response.error ?? new Error('Admin user detail response is missing data.');
      }

      return response.data;
    },
  });

  const viewedUser = userDetailQuery.data;

  useEffect(() => {
    if (!viewedUser) {
      return;
    }

    logger.info(
      {
        action: 'rootAdmin.userPage.loaded',
        data: {
          userId: viewedUser.id,
          isRootAdmin: viewedUser.isRootAdmin,
          isActive: viewedUser.isActive,
        },
      },
      'Loaded root-admin account page',
    );
  }, [logger, viewedUser]);

  const invalidateTargetUser = async () => {
    await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'admin', 'user-detail', userId] });
    await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'users'] });
  };

  const roleMutation = useMutation({
    mutationFn: async (targetUser: RootAdminViewedUser) => {
      const response = await adminSetUserRootAdmin({
        path: { userId: targetUser.id },
        body: {
          isRootAdmin: !targetUser.isRootAdmin,
          reason: reason.trim() || undefined,
        },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('Root-admin role change response is missing success confirmation.');
      }
    },
    onSuccess: async () => {
      setActiveDialog(null);
      setReason('');
      await invalidateTargetUser();
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      const response = await adminResetUserPassword({
        path: { userId },
        body: {
          reason: reason.trim() || undefined,
        },
      });

      if (!response.data?.temporaryPassword) {
        throw response.error ?? new Error('Reset-password response is missing a temporary password.');
      }

      return response.data.temporaryPassword;
    },
    onSuccess: (nextTemporaryPassword) => {
      setTemporaryPassword(nextTemporaryPassword);
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: async (targetUser: RootAdminViewedUser) => {
      if (targetUser.isActive) {
        await adminDisableUser({
          path: { userId: targetUser.id },
          body: {
            reason: reason.trim() || 'Inactivated from canonical user page',
          },
        });
        return;
      }

      await adminEnableUser({
        path: { userId: targetUser.id },
      });
    },
    onSuccess: async () => {
      setActiveDialog(null);
      setReason('');
      await invalidateTargetUser();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (targetUser: RootAdminViewedUser) => {
      const response = await adminDeleteUser({
        path: { userId: targetUser.id },
        body: {
          email: deleteEmailConfirmation,
          reason: reason.trim() || undefined,
        },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('Delete-user response is missing success confirmation.');
      }
    },
    onSuccess: async () => {
      setActiveDialog(null);
      setReason('');
      setDeleteEmailConfirmation('');
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'users'] });
      navigate('/manage/users', { replace: true });
    },
  });

  function openDialog(dialog: ActiveDialog) {
    setActiveDialog(dialog);
    setReason('');
    setTemporaryPassword(null);
    setDeleteEmailConfirmation('');
    roleMutation.reset();
    resetPasswordMutation.reset();
    lifecycleMutation.reset();
    deleteMutation.reset();
  }

  function closeDialog() {
    setActiveDialog(null);
    setReason('');
    setTemporaryPassword(null);
    setDeleteEmailConfirmation('');
    roleMutation.reset();
    resetPasswordMutation.reset();
    lifecycleMutation.reset();
    deleteMutation.reset();
  }

  if (userDetailQuery.isLoading) {
    return (
      <section className="space-y-6" data-testid="root-admin-user-page-loading">
        <div className="rounded-[2rem] border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading user account...
        </div>
      </section>
    );
  }

  if (userDetailQuery.isError || !viewedUser) {
    return (
      <section className="space-y-6" data-testid="root-admin-user-page-error">
        <div className="rounded-[2rem] border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {extractAdminError(userDetailQuery.error, 'We could not load this user account right now.')}
        </div>
      </section>
    );
  }

  const isInactive = viewedUser.isActive === false;
  const memberSince = formatMemberSince(viewedUser.createdAt, viewedUser.dateFormat);
  const deleteConfirmationMatches = deleteEmailConfirmation.trim().toLowerCase() === viewedUser.email.toLowerCase();

  return (
    <section className="space-y-6" data-testid="root-admin-user-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          User
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          User account
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          You are viewing this account as a root admin. Account-scope actions live here; league-role
          actions stay on Teams and Owners and Team Home.
        </p>
        {isInactive ? (
          <div
            className="mt-5 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            data-testid="root-admin-user-inactive-banner"
          >
            This account is inactive. Root-admin lifecycle controls can reactivate or permanently
            delete it here.
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="rounded-[1.75rem] border border-border bg-card p-6" data-testid="root-admin-user-summary">
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Account summary
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Name</dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {formatUserName(viewedUser.firstName, viewedUser.lastName)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Email</dt>
              <dd className="mt-1 text-base font-medium text-foreground">{viewedUser.email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Username</dt>
              <dd className="mt-1 text-base font-medium text-foreground">@{viewedUser.username}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Status</dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {isInactive ? 'Inactive' : 'Active'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Role</dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {viewedUser.isRootAdmin ? 'Root admin' : 'Member'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Member since
              </dt>
              <dd className="mt-1 text-base font-medium text-foreground">{memberSince}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Auth provider
              </dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {viewedUser.authProvider ?? 'EMAIL'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-[1.75rem] border border-border bg-card p-6">
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Root-admin controls
          </div>
          <div className="mt-4 grid gap-4">
            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-border bg-background px-5 py-4 text-left transition hover:border-primary/40 hover:bg-card"
              data-testid="root-admin-user-open-role"
              onClick={() => openDialog('role')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">
                  {viewedUser.isRootAdmin ? 'Demote root admin' : 'Promote to root admin'}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Root admin stays platform-scoped and backend-enforced.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">Open</span>
            </button>

            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-border bg-background px-5 py-4 text-left transition hover:border-primary/40 hover:bg-card"
              data-testid="root-admin-user-open-reset-password"
              onClick={() => openDialog('reset-password')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">Reset password</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Generates a temporary password and revokes the user&apos;s active refresh sessions.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">Open</span>
            </button>

            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-border bg-background px-5 py-4 text-left transition hover:border-primary/40 hover:bg-card"
              data-testid="root-admin-user-open-lifecycle"
              onClick={() => openDialog('lifecycle')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">
                  {isInactive ? 'Reactivate account' : 'Inactivate account'}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Manage whether this account can sign in.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">Open</span>
            </button>

            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-destructive/30 bg-destructive/5 px-5 py-4 text-left transition hover:border-destructive/40"
              data-testid="root-admin-user-open-delete"
              disabled={!isInactive || deleteMutation.isPending}
              onClick={() => openDialog('delete')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">Delete account</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Permanent delete stays locked until the account is inactive.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                {isInactive ? 'Open' : 'Locked'}
              </span>
            </button>
          </div>
        </section>
      </div>

      <UserActionDialog
        description="Root-admin role stays platform-scoped and backend-enforced."
        onOpenChange={(open) => (open ? openDialog('role') : closeDialog())}
        open={activeDialog === 'role'}
        testId="root-admin-user-role-dialog"
        title={viewedUser.isRootAdmin ? 'Demote root admin' : 'Promote to root admin'}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {viewedUser.isRootAdmin
              ? 'Removing root-admin access revokes the user’s active refresh sessions.'
              : 'Granting root-admin access allows this user to manage platform-wide administrative workflows.'}
          </p>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Reason (optional)</span>
            <textarea
              className="min-h-28 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40"
              data-testid="root-admin-user-role-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          {roleMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {extractAdminError(roleMutation.error, 'We could not update the root-admin role.')}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            onClick={closeDialog}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="root-admin-user-submit-role"
            disabled={roleMutation.isPending}
            onClick={() => void roleMutation.mutateAsync(viewedUser).catch(() => undefined)}
            type="button"
          >
            {roleMutation.isPending
              ? 'Saving...'
              : viewedUser.isRootAdmin
                ? 'Demote root admin'
                : 'Promote to root admin'}
          </button>
        </div>
      </UserActionDialog>

      <UserActionDialog
        description="This generates a temporary password for the user and revokes their active refresh sessions."
        onOpenChange={(open) => (open ? openDialog('reset-password') : closeDialog())}
        open={activeDialog === 'reset-password'}
        testId="root-admin-user-reset-password-dialog"
        title="Reset password"
      >
        <div className="space-y-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Reason (optional)</span>
            <textarea
              className="min-h-28 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40"
              data-testid="root-admin-user-reset-password-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          {temporaryPassword ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <div className="font-semibold">Temporary password</div>
              <div className="mt-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 font-mono text-foreground" data-testid="root-admin-user-temp-password">
                {temporaryPassword}
              </div>
              <p className="mt-2 text-xs text-emerald-900/80">
                Relay this to the user and have them change it after signing in.
              </p>
            </div>
          ) : null}
          {resetPasswordMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {extractAdminError(resetPasswordMutation.error, 'We could not reset this password.')}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            onClick={closeDialog}
            type="button"
          >
            Close
          </button>
          <button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="root-admin-user-submit-reset-password"
            disabled={resetPasswordMutation.isPending}
            onClick={() => void resetPasswordMutation.mutateAsync().catch(() => undefined)}
            type="button"
          >
            {resetPasswordMutation.isPending ? 'Resetting...' : 'Generate temporary password'}
          </button>
        </div>
      </UserActionDialog>

      <UserActionDialog
        description={isInactive ? 'Reactivating restores normal sign-in and account usage immediately.' : 'Inactivating revokes active refresh sessions and blocks normal sign-in until the account is reactivated.'}
        onOpenChange={(open) => (open ? openDialog('lifecycle') : closeDialog())}
        open={activeDialog === 'lifecycle'}
        testId="root-admin-user-lifecycle-dialog"
        title={isInactive ? 'Reactivate account' : 'Inactivate account'}
      >
        <div className="space-y-4">
          {!isInactive ? (
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Reason</span>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40"
                data-testid="root-admin-user-lifecycle-reason"
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </label>
          ) : null}
          {lifecycleMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {extractAdminError(lifecycleMutation.error, 'We could not update account lifecycle.')}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            onClick={closeDialog}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="root-admin-user-submit-lifecycle"
            disabled={lifecycleMutation.isPending || (!isInactive && reason.trim().length === 0)}
            onClick={() => void lifecycleMutation.mutateAsync(viewedUser).catch(() => undefined)}
            type="button"
          >
            {lifecycleMutation.isPending
              ? isInactive ? 'Reactivating...' : 'Inactivating...'
              : isInactive ? 'Reactivate account' : 'Inactivate account'}
          </button>
        </div>
      </UserActionDialog>

      <UserActionDialog
        description="Delete permanently only after the account is inactive and the email confirmation matches exactly."
        onOpenChange={(open) => (open ? openDialog('delete') : closeDialog())}
        open={activeDialog === 'delete'}
        testId="root-admin-user-delete-dialog"
        title="Delete account"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter <span className="font-medium text-foreground">{viewedUser.email}</span> to
            confirm permanent deletion.
          </p>
          <input
            autoComplete="email"
            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-destructive/40"
            data-testid="root-admin-user-delete-confirmation"
            onChange={(event) => setDeleteEmailConfirmation(event.target.value)}
            placeholder="Enter the user email exactly"
            type="email"
            value={deleteEmailConfirmation}
          />
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Reason (optional)</span>
            <textarea
              className="min-h-28 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40"
              data-testid="root-admin-user-delete-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          {deleteMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AccountDeleteDependencyMessage error={deleteMutation.error} />
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            onClick={closeDialog}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-2xl bg-destructive px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="root-admin-user-submit-delete"
            disabled={!deleteConfirmationMatches || deleteMutation.isPending}
            onClick={() => void deleteMutation.mutateAsync(viewedUser).catch(() => undefined)}
            type="button"
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete account'}
          </button>
        </div>
      </UserActionDialog>
    </section>
  );
}

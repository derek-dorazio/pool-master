import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
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
import {
  ActionList,
  ActionTile,
  Alert,
  Button,
  ConfirmDialog,
  DefinitionList,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Textarea,
  Tile,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildLeaguePath, buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import { formatUserName } from './user-name';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

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
              <Button
                aria-label={`Close ${title}`}
                className="rounded-full border border-border p-2 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                type="button"
              >
                ×
              </Button>
            </Dialog.Close>
          </div>

          <div className="mt-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RootAdminUserAccountPage({ userId }: { userId: string }) {
  const logger = getLogger().child({
    feature: 'root-admin-user-account-page',
  });
  const navigate = useNavigate();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [reason, setReason] = useState('');
  const [deleteEmailConfirmation, setDeleteEmailConfirmation] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const userDetailQuery = useQuery({
    queryKey: QueryKeys.users.detail(userId),
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

  const roleMutation = useInvalidatingMutation({
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
    },
    invalidates: [
      QueryKeys.users.detail(userId),
      QueryKeys.rootAdmin.users,
    ],
  });

  const resetPasswordMutation = useInvalidatingMutation({
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
    invalidates: [],
  });

  const lifecycleMutation = useInvalidatingMutation({
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
    },
    invalidates: [
      QueryKeys.users.detail(userId),
      QueryKeys.rootAdmin.users,
    ],
  });

  const deleteMutation = useInvalidatingMutation({
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
      navigate('/manage/users', { replace: true });
    },
    invalidates: [QueryKeys.rootAdmin.users],
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
        <LoadingState body="Loading user account..." />
      </section>
    );
  }

  if (userDetailQuery.isError || !viewedUser) {
    return (
      <section className="space-y-6" data-testid="root-admin-user-page-error">
        <ErrorState
          body={extractAdminError(userDetailQuery.error, 'We could not load this user account right now.')}
          title="User account unavailable"
        />
      </section>
    );
  }

  const isInactive = viewedUser.isActive === false;
  const memberSince = formatMemberSince(viewedUser.createdAt, viewedUser.dateFormat);
  const deleteConfirmationMatches = deleteEmailConfirmation.trim().toLowerCase() === viewedUser.email.toLowerCase();

  return (
    <section className="space-y-6" data-testid="root-admin-user-page">
      <PageHeader
        description="You are viewing this account as a root admin. Account-scope actions live here; league-role actions stay on Teams and Owners and Team Home."
        eyebrow="User"
        title="User account"
      />

      {isInactive ? (
        <Alert
          data-testid="root-admin-user-inactive-banner"
          tone="warning"
        >
          This account is inactive. Root-admin lifecycle controls can reactivate or permanently
          delete it here.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Tile data-testid="root-admin-user-summary" radius="lg">
          <div className="text-xs uppercase text-muted-foreground">
            Account summary
          </div>
          <DefinitionList
            className="mt-4"
            items={[
              {
                id: 'name',
                label: 'Name',
                value: formatUserName(viewedUser.firstName, viewedUser.lastName),
              },
              { id: 'email', label: 'Email', value: viewedUser.email },
              { id: 'username', label: 'Username', value: `@${viewedUser.username}` },
              { id: 'status', label: 'Status', value: isInactive ? 'Inactive' : 'Active' },
              { id: 'role', label: 'Role', value: viewedUser.isRootAdmin ? 'Root admin' : 'Member' },
              { id: 'member-since', label: 'Member since', value: memberSince },
              { id: 'auth-provider', label: 'Auth provider', value: viewedUser.authProvider ?? 'EMAIL' },
            ]}
          />
        </Tile>

        <Tile radius="lg">
          <div className="text-xs uppercase text-muted-foreground">
            Root-admin controls
          </div>
          <ActionList className="mt-4">
            <ActionTile
              data-testid="root-admin-user-open-role"
              description="Root admin stays platform-scoped and backend-enforced."
              label={viewedUser.isRootAdmin ? 'Demote root admin' : 'Promote to root admin'}
              onClick={() => openDialog('role')}
              trailing="Open"
            />

            <ActionTile
              data-testid="root-admin-user-open-reset-password"
              description="Generates a temporary password and revokes the user's active refresh sessions."
              label="Reset password"
              onClick={() => openDialog('reset-password')}
              trailing="Open"
            />

            <ActionTile
              data-testid="root-admin-user-open-lifecycle"
              description="Manage whether this account can sign in."
              label={isInactive ? 'Reactivate account' : 'Inactivate account'}
              onClick={() => openDialog('lifecycle')}
              trailing="Open"
            />

            <ActionTile
              data-testid="root-admin-user-open-delete"
              description="Permanent delete stays locked until the account is inactive."
              disabled={!isInactive || deleteMutation.isPending}
              label="Delete account"
              onClick={() => openDialog('delete')}
              tone="danger"
              trailing={isInactive ? 'Open' : 'Locked'}
            />
          </ActionList>
        </Tile>
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
          <FormField label="Reason (optional)">
            <Textarea
              className="min-h-28"
              data-testid="root-admin-user-role-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </FormField>
          {roleMutation.isError ? (
            <Alert tone="danger">
              {extractAdminError(roleMutation.error, 'We could not update the root-admin role.')}
            </Alert>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button
            onClick={closeDialog}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
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
          </Button>
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
          <FormField label="Reason (optional)">
            <Textarea
              className="min-h-28"
              data-testid="root-admin-user-reset-password-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </FormField>
          {temporaryPassword ? (
            <Alert tone="success">
              <div className="font-semibold">Temporary password</div>
              <div className="mt-2 rounded-xl border border-[color:var(--status-active-border)] bg-card px-3 py-2 font-mono text-foreground" data-testid="root-admin-user-temp-password">
                {temporaryPassword}
              </div>
              <p className="mt-2 text-xs">
                Relay this to the user and have them change it after signing in.
              </p>
            </Alert>
          ) : null}
          {resetPasswordMutation.isError ? (
            <Alert tone="danger">
              {extractAdminError(resetPasswordMutation.error, 'We could not reset this password.')}
            </Alert>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            onClick={closeDialog}
            type="button"
          >
            Close
          </Button>
          <Button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="root-admin-user-submit-reset-password"
            disabled={resetPasswordMutation.isPending}
            onClick={() => void resetPasswordMutation.mutateAsync().catch(() => undefined)}
            type="button"
          >
            {resetPasswordMutation.isPending ? 'Resetting...' : 'Generate temporary password'}
          </Button>
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
            <FormField label="Reason">
              <Textarea
                className="min-h-28"
                data-testid="root-admin-user-lifecycle-reason"
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </FormField>
          ) : null}
          {lifecycleMutation.isError ? (
            <Alert tone="danger">
              {extractAdminError(lifecycleMutation.error, 'We could not update account lifecycle.')}
            </Alert>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50"
            onClick={closeDialog}
            type="button"
          >
            Cancel
          </Button>
          <Button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="root-admin-user-submit-lifecycle"
            disabled={lifecycleMutation.isPending || (!isInactive && reason.trim().length === 0)}
            onClick={() => void lifecycleMutation.mutateAsync(viewedUser).catch(() => undefined)}
            type="button"
          >
            {lifecycleMutation.isPending
              ? isInactive ? 'Reactivating...' : 'Inactivating...'
              : isInactive ? 'Reactivate account' : 'Inactivate account'}
          </Button>
        </div>
      </UserActionDialog>

      <ConfirmDialog
        confirmLabel="Delete account"
        confirmTestId="root-admin-user-submit-delete"
        description="Delete permanently only after the account is inactive and the email confirmation matches exactly."
        isConfirmDisabled={!deleteConfirmationMatches}
        isPending={deleteMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => void deleteMutation.mutateAsync(viewedUser).catch(() => undefined)}
        onOpenChange={(open) => (open ? openDialog('delete') : closeDialog())}
        open={activeDialog === 'delete'}
        pendingLabel="Deleting..."
        testId="root-admin-user-delete-dialog"
        title="Delete account"
        tone="danger"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter <span className="font-medium text-foreground">{viewedUser.email}</span> to
            confirm permanent deletion.
          </p>
          <Input
            autoComplete="email"
            data-testid="root-admin-user-delete-confirmation"
            onChange={(event) => setDeleteEmailConfirmation(event.target.value)}
            placeholder="Enter the user email exactly"
            type="email"
            value={deleteEmailConfirmation}
          />
          <FormField label="Reason (optional)">
            <Textarea
              className="min-h-28"
              data-testid="root-admin-user-delete-reason"
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </FormField>
          {deleteMutation.isError ? (
            <Alert tone="danger">
              <AccountDeleteDependencyMessage error={deleteMutation.error} />
            </Alert>
          ) : null}
        </div>
      </ConfirmDialog>
    </section>
  );
}

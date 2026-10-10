import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteUser, disableUser, enableUser, getUser, resetUserPassword, setUserRootAdmin, type UserDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import {
  Alert,
  Button,
  ConfirmDialog,
  DangerZone,
  DangerZoneAction,
  ErrorState,
  formatDateDisplay,
  IdentityHeading,
  Input,
  LoadingState,
  SettingsRow,
  SettingsSection,
  StatusBadge,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';

type ActiveDialog = 'role' | 'reset-password' | 'lifecycle' | 'delete' | null;

function normalizeEmailConfirmation(value: string) {
  return value.trim().toLowerCase();
}

function extractAdminError(error: Error | null, fallback: string) {
  if (error instanceof ApiError && error.code !== undefined) {
    return `${error.code}: ${error.message}`;
  }
  return extractErrorMessage(error, { fallback });
}

/**
 * One user's home in Manage: who they are, their access (role and password) and, at the bottom,
 * the danger zone (inactivate or reactivate, then delete once inactive). League roles are not
 * here; they belong to each league's Commissioner tools.
 */
export function RootAdminUserPage() {
  const { userId = '' } = useParams<{ userId: string }>();
  const logger = getLogger().child({
    feature: 'root-admin-user-page',
  });
  const navigate = useNavigate();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [deleteEmailConfirmation, setDeleteEmailConfirmation] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  useManagePageOwnsHeading();

  const userDetailQuery = useQuery({
    queryKey: QueryKeys.users.detail(userId),
    queryFn: async () => {
      const response = await getUser({
        path: { userId },
      });

      if (!response.data?.user) {
        throwApiError(response.error, 'User read response is missing data.');
      }

      // #202 — `{ user: UserDto }`, the same envelope the current-user read uses.
      return response.data.user;
    },
  });

  const viewedUser = userDetailQuery.data;
  const displayName = viewedUser ? formatUserName(viewedUser.firstName, viewedUser.lastName) : null;

  useManageBreadcrumbOverride(userId, displayName);

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
    mutationFn: async (targetUser: UserDto) => {
      const response = await setUserRootAdmin({
        path: { userId: targetUser.id },
        body: {
          isRootAdmin: !targetUser.isRootAdmin,
        },
      });

      if (!response.data?.success) {
        throwApiError(response.error, 'Root-admin role change response is missing success confirmation.');
      }
    },
    onSuccess: () => {
      setActiveDialog(null);
    },
    invalidates: [
      QueryKeys.users.detail(userId),
      QueryKeys.rootAdmin.users,
    ],
  });

  const resetPasswordMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await resetUserPassword({
        path: { userId },
      });

      if (!response.data?.temporaryPassword) {
        throwApiError(response.error, 'Reset-password response is missing a temporary password.');
      }

      return response.data.temporaryPassword;
    },
    onSuccess: (nextTemporaryPassword) => {
      setTemporaryPassword(nextTemporaryPassword);
      setActiveDialog(null);
    },
    invalidates: [],
  });

  const lifecycleMutation = useInvalidatingMutation({
    mutationFn: async (targetUser: UserDto) => {
      // The SDK resolves a refusal rather than throwing, so the response is checked: an
      // unchecked call closed the dialog as if a refused change (the last root admin) had worked.
      const response = targetUser.isActive
        ? await disableUser({ path: { userId: targetUser.id } })
        : await enableUser({ path: { userId: targetUser.id } });

      if (!response.data?.user) {
        throwApiError(response.error, 'Account lifecycle response is missing the updated user.');
      }
    },
    onSuccess: () => {
      setActiveDialog(null);
    },
    invalidates: [
      QueryKeys.users.detail(userId),
      QueryKeys.rootAdmin.users,
    ],
  });

  const deleteMutation = useInvalidatingMutation({
    mutationFn: async (targetUser: UserDto) => {
      const response = await deleteUser({
        path: { userId: targetUser.id },
        // The typed confirmation only gates the button (compared case- and space-insensitively
        // below); the server compares exactly, so send the account's own email, as self-delete does.
        body: {
          email: targetUser.email,
        },
      });

      if (!response.data?.success) {
        throwApiError(response.error, 'Delete-user response is missing success confirmation.');
      }
    },
    onSuccess: () => {
      setActiveDialog(null);
      setDeleteEmailConfirmation('');
      navigate('/manage/users', { replace: true });
    },
    invalidates: [QueryKeys.rootAdmin.users],
  });

  function openDialog(dialog: Exclude<ActiveDialog, null>) {
    setActiveDialog(dialog);
    setDeleteEmailConfirmation('');
    roleMutation.reset();
    resetPasswordMutation.reset();
    lifecycleMutation.reset();
    deleteMutation.reset();
  }

  function closeDialog() {
    setActiveDialog(null);
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

  if (userDetailQuery.isError || !viewedUser || !displayName) {
    return (
      <section className="space-y-6" data-testid="root-admin-user-page-error">
        <ErrorState
          body={extractAdminError(userDetailQuery.error, 'We could not load this user account right now.')}
          title="User account unavailable"
        />
      </section>
    );
  }

  const isInactive = !viewedUser.isActive;
  const roleActionLabel = viewedUser.isRootAdmin ? 'Remove root admin' : 'Make root admin';
  const lifecycleLabel = isInactive ? 'Reactivate account' : 'Inactivate account';
  const deleteConfirmationMatches = normalizeEmailConfirmation(deleteEmailConfirmation) === viewedUser.email.toLowerCase();

  return (
    <div className="space-y-8" data-testid="root-admin-user-page">
      <IdentityHeading
        icon={<UserRound aria-hidden size={22} />}
        meta={<span>@{viewedUser.username}</span>}
        name={displayName}
        testId="root-admin-user-identity"
      />

      {isInactive ? (
        <Alert data-testid="root-admin-user-inactive-banner" tone="warning">
          This account is inactive. You can reactivate it or delete it permanently.
        </Alert>
      ) : null}

      <SettingsSection
        description="The user changes these on their own account page."
        testId="root-admin-user-account"
        title="Account"
      >
        <SettingsRow label="Email" testId="root-admin-user-email" value={viewedUser.email} />
        <SettingsRow label="Username" value={`@${viewedUser.username}`} />
        <SettingsRow
          label="Status"
          testId="root-admin-user-status"
          value={(
            <StatusBadge tone={isInactive ? 'inactive' : 'active'}>
              {isInactive ? 'Inactive' : 'Active'}
            </StatusBadge>
          )}
        />
        <SettingsRow label="Member since" value={formatDateDisplay(viewedUser.createdAt, 'Unknown')} />
        <SettingsRow label="Sign-in method" value={viewedUser.authProvider ?? 'EMAIL'} />
      </SettingsSection>

      <SettingsSection
        description="Root admins can manage every league, user, and sport."
        testId="root-admin-user-access"
        title="Access"
      >
        <SettingsRow
          action={(
            <Button
              data-testid="root-admin-user-open-role"
              onClick={() => openDialog('role')}
              size="sm"
              variant="secondary"
            >
              {roleActionLabel}
            </Button>
          )}
          label="Role"
          testId="root-admin-user-role"
          value={viewedUser.isRootAdmin ? 'Root admin' : 'Member'}
        />
        <SettingsRow
          action={(
            <Button
              data-testid="root-admin-user-open-reset-password"
              onClick={() => {
                setTemporaryPassword(null);
                openDialog('reset-password');
              }}
              size="sm"
              variant="secondary"
            >
              Reset password
            </Button>
          )}
          label="Password"
          value={temporaryPassword ? (
            <Alert tone="success">
              <div className="font-semibold">Temporary password</div>
              <div
                className="mt-2 rounded-xl border border-[color:var(--status-active-border)] bg-card px-3 py-2 font-mono text-foreground"
                data-testid="root-admin-user-temp-password"
              >
                {temporaryPassword}
              </div>
              <p className="mt-2 text-xs">
                Relay this to the user and have them change it after signing in.
              </p>
            </Alert>
          ) : 'Set by the user'}
        />
      </SettingsSection>

      <DangerZone
        description="Actions that stop or remove this account. Each asks you to confirm."
        testId="root-admin-user-danger-zone"
      >
        <DangerZoneAction
          action={(
            <Button
              data-testid="root-admin-user-open-lifecycle"
              onClick={() => openDialog('lifecycle')}
              size="sm"
              variant={isInactive ? 'primary' : 'danger'}
            >
              {lifecycleLabel}
            </Button>
          )}
          description={isInactive
            ? 'Restores sign-in and the account\'s place in its leagues.'
            : 'Signs the user out everywhere and hides the account from its leagues until it is reactivated.'}
          title={lifecycleLabel}
        />
        <DangerZoneAction
          action={(
            <Button
              data-testid="root-admin-user-open-delete"
              disabled={!isInactive || deleteMutation.isPending}
              onClick={() => openDialog('delete')}
              size="sm"
              variant="danger"
            >
              Delete account
            </Button>
          )}
          description={isInactive
            ? 'Removes the account permanently.'
            : 'Inactivate the account first; only an inactive account can be deleted.'}
          title="Delete account"
        />
      </DangerZone>

      <ConfirmDialog
        confirmLabel={roleActionLabel}
        confirmTestId="root-admin-user-submit-role"
        description={viewedUser.isRootAdmin
          ? 'Removing root-admin access signs the user out everywhere.'
          : 'Root admins can manage every league, user, and sport.'}
        isPending={roleMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => void roleMutation.mutateAsync(viewedUser).catch(() => undefined)}
        onOpenChange={(open) => (open ? openDialog('role') : closeDialog())}
        open={activeDialog === 'role'}
        pendingLabel="Saving..."
        testId="root-admin-user-role-dialog"
        title={`${roleActionLabel}?`}
        tone={viewedUser.isRootAdmin ? 'danger' : 'default'}
      >
        {roleMutation.isError ? (
          <Alert tone="danger">
            {extractAdminError(roleMutation.error, 'We could not update the root-admin role.')}
          </Alert>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        confirmLabel="Generate temporary password"
        confirmTestId="root-admin-user-submit-reset-password"
        description="This generates a temporary password for the user and signs them out everywhere."
        isPending={resetPasswordMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => void resetPasswordMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => (open ? openDialog('reset-password') : closeDialog())}
        open={activeDialog === 'reset-password'}
        pendingLabel="Resetting..."
        testId="root-admin-user-reset-password-dialog"
        title="Reset password?"
        tone="danger"
      >
        {resetPasswordMutation.isError ? (
          <Alert tone="danger">
            {extractAdminError(resetPasswordMutation.error, 'We could not reset this password.')}
          </Alert>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        confirmLabel={lifecycleLabel}
        confirmTestId="root-admin-user-submit-lifecycle"
        description={isInactive
          ? 'Reactivating restores normal sign-in and account usage immediately.'
          : 'Inactivating signs the user out everywhere and blocks sign-in until the account is reactivated.'}
        isPending={lifecycleMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => void lifecycleMutation.mutateAsync(viewedUser).catch(() => undefined)}
        onOpenChange={(open) => (open ? openDialog('lifecycle') : closeDialog())}
        open={activeDialog === 'lifecycle'}
        pendingLabel={isInactive ? 'Reactivating...' : 'Inactivating...'}
        testId="root-admin-user-lifecycle-dialog"
        title={`${lifecycleLabel}?`}
        tone={isInactive ? 'default' : 'danger'}
      >
        {lifecycleMutation.isError ? (
          <Alert tone="danger">
            {extractAdminError(lifecycleMutation.error, 'We could not update account lifecycle.')}
          </Alert>
        ) : null}
      </ConfirmDialog>

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
          {deleteMutation.isError ? (
            <Alert tone="danger">
              {extractAdminError(deleteMutation.error, 'We could not delete this account.')}
            </Alert>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}

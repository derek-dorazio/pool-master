import { useState, type ReactNode } from 'react';
import { deleteUser, disableUser, enableUser, resetUserPassword, type CustomerUserDto } from '@/lib/api';
import { MY_ACCOUNT_PATH } from '@/features/account/user-routing';
import { Button, ConfirmDialog, Input, LinkButton, showToast, Text, type DetailAction } from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { customerUserName } from './customer-user-facts';

type ConfirmKind = 'reset-password' | 'lifecycle' | 'delete';

const TEST_ID = 'root-admin-customer-user-dialog';

function adminError(error: Error | null, fallback: string): string {
  if (error instanceof ApiError && error.code !== undefined) {
    return `${error.code}: ${error.message}`;
  }
  return extractErrorMessage(error, { fallback });
}

/** The typed email unlocks Delete compared without case or surrounding spaces. */
export function deleteConfirmationMatches(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.toLowerCase();
}

/**
 * The user dialog's Actions (#1883): Reset password, Deactivate or Reactivate, and Delete, each
 * behind its own confirm dialog. Delete is enabled only on an inactive account and asks for the
 * account's email. A root admin's own row has none of these; it links to My account instead.
 */
export function useCustomerUserActions({
  isSelf,
  onDeleted,
  user,
}: {
  isSelf: boolean;
  onDeleted: () => void;
  user: CustomerUserDto;
}): { actions: DetailAction[]; dialogs: ReactNode; temporaryPassword: string | null } {
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [typedEmail, setTypedEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const name = customerUserName(user);
  const isInactive = !user.isActive;
  const invalidates = [QueryKeys.rootAdmin.users, QueryKeys.users.detail(user.id)];

  const resetPasswordMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await resetUserPassword({ path: { userId: user.id } });
      if (!response.data?.temporaryPassword) {
        throwApiError(response.error, 'Reset-password response is missing a temporary password.');
      }
      return response.data.temporaryPassword;
    },
    onSuccess: (password) => {
      setTemporaryPassword(password);
      setConfirming(null);
    },
    invalidates: [],
  });

  const lifecycleMutation = useInvalidatingMutation({
    mutationFn: async () => {
      // The SDK resolves a refusal rather than throwing, so the response is checked: a refused
      // change (the last root admin) must keep the dialog open with its reason.
      const response = user.isActive
        ? await disableUser({ path: { userId: user.id } })
        : await enableUser({ path: { userId: user.id } });
      if (!response.data?.user) {
        throwApiError(response.error, 'Account lifecycle response is missing the updated user.');
      }
    },
    onSuccess: () => {
      showToast({ title: isInactive ? `Reactivated ${name}` : `Deactivated ${name}`, tone: 'success' });
      setConfirming(null);
    },
    invalidates,
  });

  const deleteMutation = useInvalidatingMutation({
    mutationFn: async () => {
      // The typed email only gates the button; the server compares exactly, so send the account's own.
      const response = await deleteUser({ path: { userId: user.id }, body: { email: user.email } });
      if (!response.data?.success) {
        throwApiError(response.error, 'Delete-user response is missing success confirmation.');
      }
    },
    onSuccess: () => {
      showToast({ title: `Deleted ${name}`, tone: 'success' });
      setConfirming(null);
      onDeleted();
    },
    invalidates: [QueryKeys.rootAdmin.users],
  });

  function open(kind: ConfirmKind) {
    setTypedEmail('');
    resetPasswordMutation.reset();
    lifecycleMutation.reset();
    deleteMutation.reset();
    setConfirming(kind);
  }

  function close() {
    setConfirming(null);
    setTypedEmail('');
  }

  if (isSelf) {
    return {
      actions: [{
        id: 'my-account',
        name: 'My account',
        description: 'Your own account is changed on your account page.',
        control: (
          <LinkButton data-testid={`${TEST_ID}-my-account`} size="sm" to={MY_ACCOUNT_PATH} variant="secondary">
            My account ›
          </LinkButton>
        ),
        testId: `${TEST_ID}-action-my-account`,
      }],
      dialogs: null,
      temporaryPassword: null,
    };
  }

  const lifecycleLabel = isInactive ? 'Reactivate' : 'Deactivate';

  const actions: DetailAction[] = [
    {
      id: 'reset-password',
      name: 'Reset password',
      description: 'Makes a temporary password to relay to the user and signs them out everywhere.',
      control: (
        <Button data-testid={`${TEST_ID}-open-reset-password`} onClick={() => open('reset-password')} size="sm" variant="secondary">
          Reset password
        </Button>
      ),
      testId: `${TEST_ID}-action-reset-password`,
    },
    {
      id: 'lifecycle',
      name: lifecycleLabel,
      description: isInactive
        ? 'Restores sign-in and the account\'s place in its leagues.'
        : 'Signs the user out everywhere and blocks sign-in until the account is reactivated.',
      control: (
        <Button
          data-testid={`${TEST_ID}-open-lifecycle`}
          onClick={() => open('lifecycle')}
          size="sm"
          variant={isInactive ? 'primary' : 'danger'}
        >
          {lifecycleLabel}
        </Button>
      ),
      testId: `${TEST_ID}-action-lifecycle`,
    },
    {
      id: 'delete',
      name: 'Delete',
      description: isInactive
        ? 'Removes the account permanently.'
        : 'Deactivate the account first; only an inactive account can be deleted.',
      control: (
        <Button data-testid={`${TEST_ID}-open-delete`} disabled={!isInactive} onClick={() => open('delete')} size="sm" variant="danger">
          Delete
        </Button>
      ),
      testId: `${TEST_ID}-action-delete`,
    },
  ];

  const dialogs = (
    <>
      <ConfirmDialog
        confirmLabel="Generate temporary password"
        confirmTestId={`${TEST_ID}-submit-reset-password`}
        description="This generates a temporary password for the user and signs them out everywhere."
        error={resetPasswordMutation.isError ? adminError(resetPasswordMutation.error, 'We could not reset this password.') : null}
        isPending={resetPasswordMutation.isPending}
        onCancel={close}
        onConfirm={() => resetPasswordMutation.mutate()}
        onOpenChange={(next) => (next ? undefined : close())}
        open={confirming === 'reset-password'}
        pendingLabel="Resetting..."
        testId={`${TEST_ID}-reset-password`}
        title="Reset password?"
        tone="danger"
      />
      <ConfirmDialog
        confirmLabel={lifecycleLabel}
        confirmTestId={`${TEST_ID}-submit-lifecycle`}
        description={isInactive
          ? 'Reactivating restores normal sign-in and account usage immediately.'
          : 'Deactivating signs the user out everywhere and blocks sign-in until the account is reactivated.'}
        error={lifecycleMutation.isError ? adminError(lifecycleMutation.error, 'We could not change this account.') : null}
        isPending={lifecycleMutation.isPending}
        onCancel={close}
        onConfirm={() => lifecycleMutation.mutate()}
        onOpenChange={(next) => (next ? undefined : close())}
        open={confirming === 'lifecycle'}
        pendingLabel={isInactive ? 'Reactivating...' : 'Deactivating...'}
        testId={`${TEST_ID}-lifecycle`}
        title={`${lifecycleLabel} ${name}?`}
        tone={isInactive ? 'default' : 'danger'}
      />
      <ConfirmDialog
        confirmLabel="Delete account"
        confirmTestId={`${TEST_ID}-submit-delete`}
        description="Deletes the account permanently. This cannot be undone."
        error={deleteMutation.isError ? adminError(deleteMutation.error, 'We could not delete this account.') : null}
        isConfirmDisabled={!deleteConfirmationMatches(typedEmail, user.email)}
        isPending={deleteMutation.isPending}
        onCancel={close}
        onConfirm={() => deleteMutation.mutate()}
        onOpenChange={(next) => (next ? undefined : close())}
        open={confirming === 'delete'}
        pendingLabel="Deleting..."
        testId={`${TEST_ID}-delete`}
        title={`Delete ${name}?`}
        tone="danger"
      >
        <div className="space-y-3">
          <Text as="p" tone="muted">
            Enter <Text as="span" tone="default" variant="strong">{user.email}</Text> to confirm.
          </Text>
          <Input
            aria-label="Account email"
            autoComplete="off"
            data-testid={`${TEST_ID}-delete-confirmation`}
            onChange={(event) => setTypedEmail(event.target.value)}
            placeholder="Enter the user email exactly"
            type="email"
            value={typedEmail}
          />
        </div>
      </ConfirmDialog>
    </>
  );

  return { actions, dialogs, temporaryPassword };
}

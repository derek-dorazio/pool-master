import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteUser, disableUser, enableUser, type UserDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useAuth } from '@/features/auth/auth-context';
import { AUTH_ME_QUERY_KEY, setAuthSessionUser } from '@/features/auth/auth-session-cache';
import { Button, ConfirmDialog, HelpTip, SectionCard, SectionRow, SectionRows, useMutationActionWorkflow } from '@/features/shared/ui';
import { SELF_USER_ID } from '../user-routing';
import { ACCOUNT_ACTION_ERROR } from './my-account-helpers';

type AccountDialog = 'lifecycle' | 'delete' | null;

/**
 * My account › Account, the danger section: hide the account from its leagues (inactivate) or
 * show it again (reactivate), and delete it, which stays locked until it is inactive. Each asks
 * to confirm. An inactive account can still sign in and change its details (access rule A9).
 */
export function MyAccountAccountSection({ user }: { user: UserDto }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<AccountDialog>(null);
  const [emailConfirmation, setEmailConfirmation] = useState('');
  const isInactive = !user.isActive;

  const inactivateAction = useMutationActionWorkflow({
    action: async () => {
      const response = await disableUser({ path: { userId: SELF_USER_ID } });
      if (!response.data?.user) {
        throwApiError(response.error, 'Inactivate-account response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
    },
    invalidateQueries: [AUTH_ME_QUERY_KEY],
    onClose: () => setDialog(null),
    successToast: { title: 'Account inactivated', tone: 'success' },
  });

  const reactivateAction = useMutationActionWorkflow({
    action: async () => {
      const response = await enableUser({ path: { userId: SELF_USER_ID } });
      if (!response.data?.user) {
        throwApiError(response.error, 'Reactivate-account response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
    },
    invalidateQueries: [AUTH_ME_QUERY_KEY],
    onClose: () => setDialog(null),
    successToast: { title: 'Account reactivated', tone: 'success' },
  });

  const deleteAction = useMutationActionWorkflow({
    action: async (confirmationEmail: string) => {
      const response = await deleteUser({ path: { userId: SELF_USER_ID }, body: { email: confirmationEmail } });
      if (!response.data?.success) {
        throwApiError(response.error, 'Delete-account response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => setEmailConfirmation(''),
    onClose: () => setDialog(null),
    successToast: { title: 'Your account was deleted', tone: 'success' },
    // The account is gone, so its session is too: sign out and go home.
    navigate: () => auth.clearSession().then(() => navigate('/', { replace: true })),
  });

  const lifecycleAction = isInactive ? reactivateAction : inactivateAction;
  const closeLifecycle = () => {
    setDialog(null);
    inactivateAction.reset();
    reactivateAction.reset();
  };
  const closeDelete = () => {
    setDialog(null);
    setEmailConfirmation('');
    deleteAction.reset();
  };

  return (
    <>
      <SectionCard testId="my-account-account" title="Account" tone="danger">
        <SectionRows>
          <SectionRow
            layout="setting"
            aside={(
              <Button data-testid="my-account-lifecycle-open" onClick={() => setDialog('lifecycle')} size="sm" variant="secondary">
                {isInactive ? 'Reactivate' : 'Inactivate'}
              </Button>
            )}
            name={isInactive ? 'Show me in my leagues' : 'Hide me from my leagues'}
            testId="my-account-lifecycle"
          />
          <SectionRow
            layout="setting"
            aside={(
              <Button
                data-testid="my-account-delete-open"
                disabled={!isInactive || deleteAction.isPending}
                onClick={() => setDialog('delete')}
                size="sm"
                variant="danger"
              >
                Delete
              </Button>
            )}
            name={(
              <>
                Delete account
                <HelpTip label="About deleting your account" testId="my-account-delete-help">
                  You can delete your account once it is inactive. Deleting it can&apos;t be undone.
                </HelpTip>
              </>
            )}
            testId="my-account-delete"
          />
        </SectionRows>
      </SectionCard>

      <ConfirmDialog
        confirmLabel={isInactive ? 'Reactivate account' : 'Inactivate account'}
        confirmTestId={isInactive ? 'my-account-reactivate' : 'my-account-inactivate'}
        description={isInactive
          ? 'Your account will be active again straight away, and your leagues will see you.'
          : "You'll be signed out everywhere and hidden from your leagues. You can reactivate or delete the account later."}
        error={lifecycleAction.isError ? extractErrorMessage(lifecycleAction.error, { fallback: ACCOUNT_ACTION_ERROR }) : null}
        isPending={lifecycleAction.isPending}
        onCancel={closeLifecycle}
        onConfirm={() => void lifecycleAction.run().catch(() => undefined)}
        onOpenChange={(open) => (open ? setDialog('lifecycle') : closeLifecycle())}
        open={dialog === 'lifecycle'}
        pendingLabel={isInactive ? 'Reactivating...' : 'Inactivating...'}
        testId="my-account-lifecycle-dialog"
        title={isInactive ? 'Reactivate account' : 'Inactivate account'}
      />

      <ConfirmDialog
        confirmLabel="Delete account"
        confirmTestId="my-account-delete-submit"
        confirmationInput={{
          expectedValue: user.email,
          helperText: `Enter ${user.email} exactly to confirm.`,
          label: 'Email confirmation',
          onChange: setEmailConfirmation,
          testId: 'my-account-delete-confirmation',
          value: emailConfirmation,
        }}
        description="Your account and its data will be deleted permanently."
        error={deleteAction.isError ? extractErrorMessage(deleteAction.error, { fallback: ACCOUNT_ACTION_ERROR }) : null}
        isPending={deleteAction.isPending}
        onCancel={closeDelete}
        onConfirm={() => void deleteAction.run(user.email).catch(() => undefined)}
        onOpenChange={(open) => (open ? setDialog('delete') : closeDelete())}
        open={dialog === 'delete'}
        pendingLabel="Deleting..."
        testId="my-account-delete-dialog"
        title="Delete account"
        tone="danger"
      />
    </>
  );
}

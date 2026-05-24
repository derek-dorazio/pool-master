import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Controller,
  useForm,
  useWatch,
} from 'react-hook-form';
import { z } from 'zod';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AccountPasswordChangeRequestSchema,
  AccountProfileUpdateRequestSchema,
  AccountPreferencesUpdateRequestSchema,
  AccountUsernameUpdateRequestSchema,
} from '@poolmaster/shared/dto';
import {
  changeAccountPassword,
  deleteAccount,
  inactivateAccount,
  reactivateAccount,
  updateAccountPreferences,
  updateAccountProfile,
  updateAccountUsername,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  AUTH_ME_QUERY_KEY,
  setAuthSessionUser,
} from '@/features/auth/auth-session-cache';
import {
  ActionList,
  ActionTile,
  Alert,
  Button,
  ConfirmationModal,
  EntityDetailPage,
  FormModal,
  FormField,
  Input,
  LinkButton,
  Modal,
  MutationActionToast,
  Select,
  Tile,
  useMutationActionWorkflow,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { RootAdminUserAccountPage } from './root-admin-user-account-page';
import { UserAccountSummary } from './user-account-summary';
import { formatUserName } from './user-name';
import { buildUserPath } from './user-routing';
import { extractErrorMessage } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

type AccountProfileFormValues = z.infer<typeof AccountProfileUpdateRequestSchema>;
type AccountUsernameFormValues = z.infer<typeof AccountUsernameUpdateRequestSchema>;
type AccountPreferencesFormValues = z.infer<typeof AccountPreferencesUpdateRequestSchema>;
type AccountPasswordFormValues = z.infer<typeof AccountPasswordChangeRequestSchema>;

type ActiveDialog = 'profile' | 'username' | 'preferences' | 'password' | 'lifecycle' | 'delete' | null;

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
    <Modal
      closeLabel={`Close ${title}`}
      description={description}
      descriptionId={`${testId}-description`}
      onOpenChange={onOpenChange}
      open={open}
      testId={testId}
      title={title}
    >
      {children}
    </Modal>
  );
}

export function UserPage() {
  const auth = useAuth();
  const logger = getLogger().child({
    feature: 'user-page',
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userId = '' } = useParams<{ userId: string }>();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [emailConfirmation, setEmailConfirmation] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const profileForm = useForm<AccountProfileFormValues>({
    resolver: zodResolver(AccountProfileUpdateRequestSchema),
    mode: 'onSubmit',
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
    },
  });
  const usernameForm = useForm<AccountUsernameFormValues>({
    resolver: zodResolver(AccountUsernameUpdateRequestSchema),
    mode: 'onSubmit',
    defaultValues: {
      username: '',
    },
  });
  const preferencesForm = useForm<AccountPreferencesFormValues>({
    resolver: zodResolver(AccountPreferencesUpdateRequestSchema),
    mode: 'onSubmit',
    defaultValues: {
      timezone: null,
      locale: null,
      timeFormat: null,
      dateFormat: null,
    },
  });
  const passwordForm = useForm<AccountPasswordFormValues>({
    resolver: zodResolver(AccountPasswordChangeRequestSchema),
    mode: 'onSubmit',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    },
  });
  const [profileEmail, profileFirstName, profileLastName] = useWatch({
    control: profileForm.control,
    name: ['email', 'firstName', 'lastName'],
  });
  const usernameValue = useWatch({
    control: usernameForm.control,
    name: 'username',
  });
  const [currentPassword, newPassword, confirmNewPassword] = useWatch({
    control: passwordForm.control,
    name: ['currentPassword', 'newPassword', 'confirmNewPassword'],
  });

  const user = auth.user;
  const selfUserId = user?.id ?? '';
  const isSelf = Boolean(user && userId === selfUserId);

  useEffect(() => {
    if (!user) {
      return;
    }

    logger.info(
      {
        action: 'user.page.loaded',
        data: {
          requestedUserId: userId || null,
          selfUserId: user.id,
          isSelf,
          isActive: user.isActive !== false,
          isRootAdmin: user.isRootAdmin,
        },
      },
      'Loaded canonical user page state',
    );
  }, [isSelf, logger, user, userId]);

  const profileMutation = useInvalidatingMutation({
    mutationFn: async (values: AccountProfileFormValues) => {
      const response = await updateAccountProfile({
        body: {
          email: values.email.trim().toLowerCase(),
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
        },
      });
      if (!response.data?.user) {
        throw response.error ?? new Error('Profile update response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
    },
    invalidates: [AUTH_ME_QUERY_KEY],
  });

  const usernameMutation = useInvalidatingMutation({
    mutationFn: async (values: AccountUsernameFormValues) => {
      const response = await updateAccountUsername({
        body: {
          username: values.username.trim().toLowerCase(),
        },
      });
      if (!response.data?.user) {
        throw response.error ?? new Error('Username update response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
    },
    invalidates: [AUTH_ME_QUERY_KEY],
  });

  const preferencesMutation = useInvalidatingMutation({
    mutationFn: async (values: AccountPreferencesFormValues) => {
      const response = await updateAccountPreferences({
        body: {
          timezone: values.timezone?.trim() || undefined,
          locale: values.locale?.trim() || undefined,
          timeFormat: values.timeFormat ?? undefined,
          dateFormat: values.dateFormat ?? undefined,
        },
      });
      if (!response.data?.user) {
        throw response.error ?? new Error('Preferences update response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
    },
    invalidates: [AUTH_ME_QUERY_KEY],
  });

  const passwordMutation = useInvalidatingMutation({
    mutationFn: async (values: AccountPasswordFormValues) => {
      const response = await changeAccountPassword({
        body: {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
          confirmNewPassword: values.confirmNewPassword,
        },
      });
      if (!response.data?.success) {
        throw response.error ?? new Error('Password-change response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      passwordForm.reset({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
      });
    },
    invalidates: [],
  });

  const inactivateAccountAction = useMutationActionWorkflow({
    action: async () => {
      const response = await inactivateAccount();
      if (!response.data?.user) {
        throw response.error ?? new Error('Inactivate-account response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
    },
    invalidateQueries: [AUTH_ME_QUERY_KEY],
    onClose: () => setActiveDialog(null),
    successToast: {
      title: 'Account inactive',
      description: 'Your account was inactivated.',
      tone: 'success',
    },
  });

  const reactivateAccountAction = useMutationActionWorkflow({
    action: async () => {
      const response = await reactivateAccount();
      if (!response.data?.user) {
        throw response.error ?? new Error('Reactivate-account response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
    },
    invalidateQueries: [AUTH_ME_QUERY_KEY],
    onClose: () => setActiveDialog(null),
    successToast: {
      title: 'Account active',
      description: 'Your account was reactivated.',
      tone: 'success',
    },
  });

  const deleteAccountAction = useMutationActionWorkflow({
    action: async (confirmationEmail: string) => {
      const response = await deleteAccount({
        body: {
          email: confirmationEmail,
        },
      });
      if (!response.data?.success) {
        throw response.error ?? new Error('Delete-account response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      setDeleteSuccess(true);
      setEmailConfirmation('');
    },
    onClose: () => setActiveDialog(null),
  });

  if (!user) {
    return (
      <section className="space-y-6" data-testid="user-page-loading">
        <Tile>
          Loading user page...
        </Tile>
      </section>
    );
  }

  if (!isSelf) {
    if (user.isRootAdmin) {
      return <RootAdminUserAccountPage userId={userId} />;
    }

    return (
      <section className="space-y-6" data-testid="user-page-non-self-placeholder">
        <Tile padding="lg">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            User
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            User profile unavailable
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            You do not have access to view this user profile.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Requested user id: <span className="font-medium text-foreground">{userId}</span>
          </p>
        </Tile>

        <Tile>
          <p className="text-sm text-muted-foreground">
            Your own user page is ready now and contains profile, preferences, password, and
            lifecycle actions as dedicated dialogs.
          </p>
          <LinkButton
            className="mt-5"
            data-testid="user-page-self-link"
            variant="subtle"
            to={buildUserPath(selfUserId)}
          >
            Open my user page
          </LinkButton>
        </Tile>
      </section>
    );
  }

  const activeUser = user;
  const isInactive = activeUser.isActive === false;
  const memberSince = formatMemberSince(activeUser.createdAt, activeUser.dateFormat);
  const disableProfileEditing = isInactive || profileMutation.isPending;
  const disableUsernameEditing = isInactive || usernameMutation.isPending;
  const disablePreferencesEditing = isInactive || preferencesMutation.isPending;
  const disablePasswordEditing = isInactive || passwordMutation.isPending;
  const activeLifecycleAction = isInactive ? reactivateAccountAction : inactivateAccountAction;

  function openProfileDialog() {
    profileForm.reset({
      email: activeUser.email ?? '',
      firstName: activeUser.firstName ?? '',
      lastName: activeUser.lastName ?? '',
    });
    profileMutation.reset();
    setActiveDialog('profile');
  }

  function openUsernameDialog() {
    usernameForm.reset({
      username: activeUser.username ?? '',
    });
    usernameMutation.reset();
    setActiveDialog('username');
  }

  function openPreferencesDialog() {
    preferencesForm.reset({
      timezone: activeUser.timezone ?? null,
      locale: activeUser.locale ?? null,
      timeFormat: activeUser.timeFormat ?? null,
      dateFormat: activeUser.dateFormat ?? null,
    });
    preferencesMutation.reset();
    setActiveDialog('preferences');
  }

  function openPasswordDialog() {
    passwordForm.reset({
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    });
    passwordMutation.reset();
    setActiveDialog('password');
  }

  return (
    <section className="space-y-6" data-testid="user-page">
      <Tile padding="lg">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          My profile
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Manage your user profile, preferences, login, and account information.
        </p>
        {isInactive ? (
          <Alert
            className="mt-5"
            data-testid="user-page-inactive-banner"
            tone="warning"
          >
            Your account is inactive. Self-service actions stay available here, but profile,
            preferences, and password edits remain read-only until you reactivate.
          </Alert>
        ) : null}
      </Tile>

      {deleteSuccess ? (
        <Alert
          data-testid="user-page-delete-success"
          tone="success"
          title="Your account was deleted."
        >
          <p className="mt-2 text-sm">You no longer have access to Prime Time Commissioner with this account.</p>
          <Button
            className="mt-4"
            onClick={() =>
              void auth.clearSession().then(() => {
                navigate('/', { replace: true });
              })
            }
            type="button"
          >
            Exit and sign out
          </Button>
        </Alert>
      ) : null}

      <EntityDetailPage
        actions={(
          <ActionList>
            <ActionTile
              description="Update the name and email shown in account surfaces."
              data-testid="user-page-open-profile"
              label="Edit profile"
              onClick={openProfileDialog}
              trailing="Open"
            />

            <ActionTile
              description="Update the login username used for this account."
              data-testid="user-page-open-username"
              label="Change username"
              onClick={openUsernameDialog}
              trailing="Open"
            />

            <ActionTile
              description="Manage timezone, locale, and date/time formatting."
              data-testid="user-page-open-preferences"
              label="Edit preferences"
              onClick={openPreferencesDialog}
              trailing="Open"
            />

            <ActionTile
              description="Keep your current session while revoking your other refresh sessions."
              data-testid="user-page-open-password"
              label="Change password"
              onClick={openPasswordDialog}
              trailing="Open"
            />

            <ActionTile
              description="Manage whether your account can sign in."
              data-testid="user-page-open-lifecycle"
              label={isInactive ? 'Reactivate account' : 'Inactivate account'}
              onClick={() => setActiveDialog('lifecycle')}
              trailing="Open"
            />

            <ActionTile
              description="Permanent delete stays locked until the account is inactive."
              data-testid="user-page-open-delete"
              disabled={!isInactive || deleteAccountAction.isPending}
              label="Delete account"
              onClick={() => setActiveDialog('delete')}
              tone="danger"
              trailing={isInactive ? 'Open' : 'Locked'}
            />
          </ActionList>
        )}
        actionsTestId="user-page-actions-tile"
        details={(
          <UserAccountSummary
            email={user.email}
            memberSince={memberSince}
            method={user.authProvider ?? 'EMAIL'}
            name={formatUserName(user.firstName, user.lastName)}
            role={user.isRootAdmin ? 'Root admin' : 'Member'}
            status={isInactive ? 'Inactive' : 'Active'}
            username={user.username}
          />
        )}
      />

      <FormModal
        canSave={
          !disableProfileEditing
          && (profileEmail ?? '').trim().length > 0
          && (profileFirstName ?? '').trim().length > 0
          && (profileLastName ?? '').trim().length > 0
        }
        description="Keep your personal name accurate for membership and account surfaces."
        error={profileMutation.isError ? profileMutation.error : null}
        errorFallback="We could not save your profile."
        isPending={profileMutation.isPending}
        onCancel={() => setActiveDialog(null)}
        onOpenChange={(open) => {
          if (open) {
            openProfileDialog();
            return;
          }

          setActiveDialog(null);
        }}
        open={activeDialog === 'profile'}
        onSave={() =>
          void profileForm.handleSubmit((values) =>
            profileMutation.mutateAsync(values).catch(() => undefined),
          )()
        }
        pendingLabel="Saving..."
        saveLabel="Save profile"
        saveTestId="user-page-save-profile"
        testId="user-page-profile-dialog"
        title="Edit profile"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            error={profileForm.formState.errors.firstName?.message}
            label="First name"
          >
            <Input
              data-testid="user-page-first-name"
              disabled={disableProfileEditing}
              {...profileForm.register('firstName', {
                onChange: () => profileMutation.reset(),
              })}
            />
          </FormField>
          <FormField
            error={profileForm.formState.errors.lastName?.message}
            label="Last name"
          >
            <Input
              data-testid="user-page-last-name"
              disabled={disableProfileEditing}
              {...profileForm.register('lastName', {
                onChange: () => profileMutation.reset(),
              })}
            />
          </FormField>
          <FormField
            className="sm:col-span-2"
            error={profileForm.formState.errors.email?.message}
            label="Email"
          >
            <Input
              data-testid="user-page-email"
              disabled={disableProfileEditing}
              {...profileForm.register('email', {
                onChange: () => profileMutation.reset(),
              })}
              type="email"
            />
          </FormField>
        </div>

        {profileMutation.isSuccess ? (
          <Alert className="mt-4" tone="success">
            Your profile was updated.
          </Alert>
        ) : null}
      </FormModal>

      <FormModal
        canSave={!disableUsernameEditing && (usernameValue ?? '').trim().length >= 3}
        description="Choose a unique username for signing in and identifying your account."
        error={usernameMutation.isError ? usernameMutation.error : null}
        errorFallback="We could not save your username."
        isPending={usernameMutation.isPending}
        onCancel={() => setActiveDialog(null)}
        onOpenChange={(open) => {
          if (open) {
            openUsernameDialog();
            return;
          }

          setActiveDialog(null);
        }}
        open={activeDialog === 'username'}
        onSave={() =>
          void usernameForm.handleSubmit((values) =>
            usernameMutation.mutateAsync(values).catch(() => undefined),
          )()
        }
        pendingLabel="Saving..."
        saveLabel="Save username"
        saveTestId="user-page-save-username"
        testId="user-page-username-dialog"
        title="Change username"
      >
        <FormField
          error={usernameForm.formState.errors.username?.message}
          label="Username"
        >
          <Input
            data-testid="user-page-username"
            disabled={disableUsernameEditing}
            {...usernameForm.register('username', {
              onChange: () => usernameMutation.reset(),
            })}
          />
        </FormField>

        {usernameMutation.isSuccess ? (
          <Alert className="mt-4" tone="success">
            Your username was updated.
          </Alert>
        ) : null}
      </FormModal>

      <FormModal
        canSave={!disablePreferencesEditing}
        description="These settings control how dates, times, and locale-aware copy appear for you."
        error={preferencesMutation.isError ? preferencesMutation.error : null}
        errorFallback="We could not save your preferences."
        isPending={preferencesMutation.isPending}
        onCancel={() => setActiveDialog(null)}
        onOpenChange={(open) => {
          if (open) {
            openPreferencesDialog();
            return;
          }

          setActiveDialog(null);
        }}
        open={activeDialog === 'preferences'}
        onSave={() =>
          void preferencesForm.handleSubmit((values) =>
            preferencesMutation.mutateAsync(values).catch(() => undefined),
          )()
        }
        pendingLabel="Saving..."
        saveLabel="Save preferences"
        saveTestId="user-page-save-preferences"
        testId="user-page-preferences-dialog"
        title="Edit preferences"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            error={preferencesForm.formState.errors.timezone?.message}
            label="Timezone"
          >
            <Controller
              control={preferencesForm.control}
              name="timezone"
              render={({ field }) => (
                <Input
                  data-testid="user-page-timezone"
                  disabled={disablePreferencesEditing}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    preferencesMutation.reset();
                    field.onChange(event.target.value.trim() ? event.target.value : null);
                  }}
                  placeholder="America/New_York"
                  ref={field.ref}
                  value={field.value ?? ''}
                />
              )}
            />
          </FormField>
          <FormField
            error={preferencesForm.formState.errors.locale?.message}
            label="Locale"
          >
            <Controller
              control={preferencesForm.control}
              name="locale"
              render={({ field }) => (
                <Input
                  data-testid="user-page-locale"
                  disabled={disablePreferencesEditing}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    preferencesMutation.reset();
                    field.onChange(event.target.value.trim() ? event.target.value : null);
                  }}
                  placeholder="en-US"
                  ref={field.ref}
                  value={field.value ?? ''}
                />
              )}
            />
          </FormField>
          <FormField
            error={preferencesForm.formState.errors.timeFormat?.message}
            label="Time format"
          >
            <Controller
              control={preferencesForm.control}
              name="timeFormat"
              render={({ field }) => (
                <Select
                  data-testid="user-page-time-format"
                  disabled={disablePreferencesEditing}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    preferencesMutation.reset();
                    field.onChange(event.target.value || null);
                  }}
                  ref={field.ref}
                  value={field.value ?? ''}
                >
                  <option value="">System default</option>
                  <option value="12H">12-hour</option>
                  <option value="24H">24-hour</option>
                </Select>
              )}
            />
          </FormField>
          <FormField
            error={preferencesForm.formState.errors.dateFormat?.message}
            label="Date format"
          >
            <Controller
              control={preferencesForm.control}
              name="dateFormat"
              render={({ field }) => (
                <Select
                  data-testid="user-page-date-format"
                  disabled={disablePreferencesEditing}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    preferencesMutation.reset();
                    field.onChange(event.target.value || null);
                  }}
                  ref={field.ref}
                  value={field.value ?? ''}
                >
                  <option value="">System default</option>
                  <option value="MDY">MM/DD/YYYY</option>
                  <option value="DMY">DD/MM/YYYY</option>
                  <option value="YMD">YYYY-MM-DD</option>
                </Select>
              )}
            />
          </FormField>
        </div>

        {preferencesMutation.isSuccess ? (
          <Alert className="mt-4" tone="success">
            Your preferences were updated.
          </Alert>
        ) : null}
      </FormModal>

      <UserActionDialog
        description="Changing your password keeps the current session active and revokes your other refresh sessions."
        onOpenChange={(open) => {
          if (open) {
            openPasswordDialog();
            return;
          }

          setActiveDialog(null);
        }}
        open={activeDialog === 'password'}
        testId="user-page-password-dialog"
        title="Change password"
      >
        <div className="space-y-4">
          <FormField
            error={passwordForm.formState.errors.currentPassword?.message}
            label="Current password"
          >
            <Input
              data-testid="user-page-current-password"
              disabled={disablePasswordEditing}
              {...passwordForm.register('currentPassword', {
                onChange: () => passwordMutation.reset(),
              })}
              type="password"
            />
          </FormField>
          <FormField
            error={passwordForm.formState.errors.newPassword?.message}
            label="New password"
          >
            <Input
              data-testid="user-page-new-password"
              disabled={disablePasswordEditing}
              {...passwordForm.register('newPassword', {
                onChange: () => passwordMutation.reset(),
              })}
              type="password"
            />
          </FormField>
          <FormField
            error={passwordForm.formState.errors.confirmNewPassword?.message}
            label="Confirm new password"
          >
            <Input
              data-testid="user-page-confirm-password"
              disabled={disablePasswordEditing}
              {...passwordForm.register('confirmNewPassword', {
                onChange: () => passwordMutation.reset(),
              })}
              type="password"
            />
          </FormField>
        </div>

        {passwordMutation.isError ? (
          <Alert className="mt-4" tone="danger">
            {extractErrorMessage(passwordMutation.error, { fallback: 'We could not complete that account action. Please try again.' })}
          </Alert>
        ) : null}
        {passwordMutation.isSuccess ? (
          <Alert className="mt-4" tone="success">
            Your password was changed.
          </Alert>
        ) : null}

        <div className="mt-5 flex justify-end">
          <Button
            data-testid="user-page-save-password"
            disabled={
              disablePasswordEditing
              || (currentPassword ?? '').length === 0
              || (newPassword ?? '').length < 8
              || (confirmNewPassword ?? '').length < 8
            }
            onClick={() =>
              void passwordForm.handleSubmit((values) =>
                passwordMutation.mutateAsync(values).catch(() => undefined),
              )()
            }
            type="button"
          >
            {passwordMutation.isPending ? 'Saving...' : 'Change password'}
          </Button>
        </div>
      </UserActionDialog>

      <UserActionDialog
        description="Inactivate first, then delete permanently only after the account is inactive."
        onOpenChange={(open) => {
          setActiveDialog(open ? 'lifecycle' : null);
          if (!open) {
            inactivateAccountAction.reset();
            reactivateAccountAction.reset();
          }
        }}
        open={activeDialog === 'lifecycle'}
        testId="user-page-lifecycle-dialog"
        title={isInactive ? 'Reactivate account' : 'Inactivate account'}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isInactive
              ? 'Reactivating your account restores normal Prime Time Commissioner usage immediately.'
              : 'Inactivating your account turns profile, preferences, and password management read-only until you reactivate or permanently delete the account.'}
          </p>
          {activeLifecycleAction.isError ? (
            <Alert tone="danger">
              {extractErrorMessage(activeLifecycleAction.error, { fallback: 'We could not complete that account action. Please try again.' })}
            </Alert>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end">
          {isInactive ? (
            <Button
              data-testid="user-page-reactivate"
              disabled={reactivateAccountAction.isPending || deleteAccountAction.isPending}
              isLoading={reactivateAccountAction.isPending}
              onClick={() => void reactivateAccountAction.run().catch(() => undefined)}
              type="button"
            >
              {reactivateAccountAction.isPending ? 'Reactivating...' : 'Reactivate account'}
            </Button>
          ) : (
            <Button
              data-testid="user-page-inactivate"
              disabled={inactivateAccountAction.isPending || deleteAccountAction.isPending}
              isLoading={inactivateAccountAction.isPending}
              onClick={() => void inactivateAccountAction.run().catch(() => undefined)}
              variant="secondary"
              type="button"
            >
              {inactivateAccountAction.isPending ? 'Inactivating...' : 'Inactivate account'}
            </Button>
          )}
        </div>
      </UserActionDialog>

      <ConfirmationModal
        confirmLabel="Delete account"
        confirmTestId="user-page-delete-submit"
        confirmationInput={{
          expectedValue: user.email,
          helperText: "Enter your email exactly to confirm permanent deletion.",
          label: "Email confirmation",
          onChange: setEmailConfirmation,
          testId: "user-page-delete-confirmation",
          value: emailConfirmation,
        }}
        description="Delete permanently only after the account is inactive and the email confirmation matches exactly."
        isPending={deleteAccountAction.isPending}
        onCancel={() => {
          setActiveDialog(null);
          setEmailConfirmation('');
          deleteAccountAction.reset();
        }}
        onConfirm={() => void deleteAccountAction.run(user.email).catch(() => undefined)}
        onOpenChange={(open) => {
          setActiveDialog(open ? 'delete' : null);
          if (!open) {
            setEmailConfirmation('');
            deleteAccountAction.reset();
          }
        }}
        open={activeDialog === 'delete'}
        pendingLabel="Deleting..."
        testId="user-page-delete-dialog"
        title="Delete account"
        tone="danger"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This action will delete your account and related data permanently. Enter{' '}
            <span className="font-medium text-foreground">{user.email}</span> to continue.
          </p>
          {deleteAccountAction.isError ? (
            <Alert tone="danger">
              {extractErrorMessage(deleteAccountAction.error, { fallback: 'We could not complete that account action. Please try again.' })}
            </Alert>
          ) : null}
        </div>
      </ConfirmationModal>

      <MutationActionToast
        onDismiss={inactivateAccountAction.dismissToast}
        toast={inactivateAccountAction.toast}
      />
      <MutationActionToast
        onDismiss={reactivateAccountAction.dismissToast}
        toast={reactivateAccountAction.toast}
      />
    </section>
  );
}

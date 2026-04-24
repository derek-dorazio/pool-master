import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  changeAccountPassword,
  deleteAccount,
  inactivateAccount,
  reactivateAccount,
  updateAccountPreferences,
  updateAccountProfile,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { useLogger } from '@/lib/logger';
import { RootAdminUserAccountPage } from './root-admin-user-account-page';
import { formatUserName } from './user-name';
import { buildUserPath } from './user-routing';

type AccountPreferencesFormState = {
  timezone: string;
  locale: string;
  timeFormat: '' | '12H' | '24H';
  dateFormat: '' | 'MDY' | 'DMY' | 'YMD';
};

type ActiveDialog = 'profile' | 'preferences' | 'password' | 'lifecycle' | 'delete' | null;

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'We could not complete that account action. Please try again.';
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return 'We could not complete that account action. Please try again.';
}

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

export function UserPage() {
  const auth = useAuth();
  const logger = useLogger().child({
    feature: 'user-page',
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);
  const { userId = '' } = useParams<{ userId: string }>();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [emailConfirmation, setEmailConfirmation] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
  });
  const [preferencesForm, setPreferencesForm] = useState<AccountPreferencesFormState>({
    timezone: '',
    locale: '',
    timeFormat: '',
    dateFormat: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  });

  const user = auth.user;
  const selfUserId = user?.id ?? '';
  const isSelf = Boolean(user && userId === selfUserId);

  useEffect(() => {
    if (!user) {
      return;
    }

    setProfileForm({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
    });
    setPreferencesForm({
      timezone: user.timezone ?? '',
      locale: user.locale ?? '',
      timeFormat: user.timeFormat ?? '',
      dateFormat: user.dateFormat ?? '',
    });
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

  const applyUserToSession = async (updatedUser: Parameters<typeof setSession>[0]) => {
    setSession(updatedUser);
    queryClient.setQueryData(['poolmaster', 'auth', 'me'], updatedUser);
    await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'auth', 'me'] });
  };

  const profileMutation = useMutation({
    mutationFn: async () => {
      const response = await updateAccountProfile({
        body: {
          firstName: profileForm.firstName.trim(),
          lastName: profileForm.lastName.trim(),
        },
      });
      if (!response.data?.user) {
        throw response.error ?? new Error('Profile update response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      await applyUserToSession(updatedUser);
    },
  });

  const preferencesMutation = useMutation({
    mutationFn: async () => {
      const response = await updateAccountPreferences({
        body: {
          timezone: preferencesForm.timezone.trim() || undefined,
          locale: preferencesForm.locale.trim() || undefined,
          timeFormat: preferencesForm.timeFormat || undefined,
          dateFormat: preferencesForm.dateFormat || undefined,
        },
      });
      if (!response.data?.user) {
        throw response.error ?? new Error('Preferences update response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      await applyUserToSession(updatedUser);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      const response = await changeAccountPassword({
        body: {
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
          confirmNewPassword: passwordForm.confirmNewPassword,
        },
      });
      if (!response.data?.success) {
        throw response.error ?? new Error('Password-change response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: '',
      });
    },
  });

  const inactivateMutation = useMutation({
    mutationFn: async () => {
      const response = await inactivateAccount();
      if (!response.data?.user) {
        throw response.error ?? new Error('Inactivate-account response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      await applyUserToSession(updatedUser);
      setActiveDialog(null);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const response = await reactivateAccount();
      if (!response.data?.user) {
        throw response.error ?? new Error('Reactivate-account response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      await applyUserToSession(updatedUser);
      setActiveDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (confirmationEmail: string) => {
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
      setActiveDialog(null);
      setEmailConfirmation('');
    },
  });

  if (!user) {
    return (
      <section className="space-y-6" data-testid="user-page-loading">
        <div className="rounded-[2rem] border border-border bg-card p-6 text-sm text-muted-foreground">
          Loading user page...
        </div>
      </section>
    );
  }

  if (!isSelf) {
    if (user.isRootAdmin) {
      return <RootAdminUserAccountPage userId={userId} />;
    }

    return (
      <section className="space-y-6" data-testid="user-page-non-self-placeholder">
        <div className="rounded-[2rem] border border-border bg-card p-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            User
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            Cross-user profile views land next
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            The canonical user route now owns self-service account actions, but non-root-admin
            viewer detail still depends on the broader user-detail contract in the next slice.
            This page stays truthful until that contract lands.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Requested user id: <span className="font-medium text-foreground">{userId}</span>
          </p>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Your own user page is ready now and contains profile, preferences, password, and
            lifecycle actions as dedicated dialogs.
          </p>
          <Link
            className="mt-5 inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
            data-testid="user-page-self-link"
            to={buildUserPath(selfUserId)}
          >
            Open my user page
          </Link>
        </div>
      </section>
    );
  }

  const confirmationMatches = emailConfirmation.trim().toLowerCase() === user.email.toLowerCase();
  const isInactive = user.isActive === false;
  const memberSince = formatMemberSince(user.createdAt, user.dateFormat);
  const disableProfileEditing = isInactive || profileMutation.isPending;
  const disablePreferencesEditing = isInactive || preferencesMutation.isPending;
  const disablePasswordEditing = isInactive || passwordMutation.isPending;

  return (
    <section className="space-y-6" data-testid="user-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          User
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          My profile
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          The canonical user route now owns your self-service account actions. Cross-user detail
          and admin-authority tools will land in the next slices.
        </p>
        {isInactive ? (
          <div
            className="mt-5 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            data-testid="user-page-inactive-banner"
          >
            Your account is inactive. Self-service actions stay available here, but profile,
            preferences, and password edits remain read-only until you reactivate.
          </div>
        ) : null}
      </div>

      {deleteSuccess ? (
        <div
          className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-6 text-emerald-800"
          data-testid="user-page-delete-success"
        >
          <div className="text-lg font-semibold">Your account was deleted.</div>
          <p className="mt-2 text-sm">You no longer have access to PoolMaster with this account.</p>
          <button
            className="mt-4 rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95"
            onClick={() =>
              void auth.clearSession().then(() => {
                queryClient.removeQueries({ queryKey: ['poolmaster', 'auth'] });
                navigate('/', { replace: true });
              })
            }
            type="button"
          >
            Exit and sign out
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="rounded-[1.75rem] border border-border bg-card p-6">
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Account summary
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Name</dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {formatUserName(user.firstName, user.lastName)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Email</dt>
              <dd className="mt-1 text-base font-medium text-foreground">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Username</dt>
              <dd className="mt-1 text-base font-medium text-foreground">{user.username}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Status</dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {isInactive ? 'Inactive' : 'Active'}
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
                {user.authProvider ?? 'EMAIL'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Role</dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {user.isRootAdmin ? 'Root admin' : 'Member'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-[1.75rem] border border-border bg-card p-6">
          <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Actions</div>
          <div className="mt-4 grid gap-4">
            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-border bg-background px-5 py-4 text-left transition hover:border-primary/40 hover:bg-card"
              data-testid="user-page-open-profile"
              onClick={() => setActiveDialog('profile')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">Edit profile</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Update the name shown in account and membership surfaces.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">Open</span>
            </button>

            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-border bg-background px-5 py-4 text-left transition hover:border-primary/40 hover:bg-card"
              data-testid="user-page-open-preferences"
              onClick={() => setActiveDialog('preferences')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">
                  Edit preferences
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Manage timezone, locale, and date/time formatting.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">Open</span>
            </button>

            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-border bg-background px-5 py-4 text-left transition hover:border-primary/40 hover:bg-card"
              data-testid="user-page-open-password"
              onClick={() => setActiveDialog('password')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">Change password</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Keep your current session while revoking your other refresh sessions.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">Open</span>
            </button>

            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-border bg-background px-5 py-4 text-left transition hover:border-primary/40 hover:bg-card"
              data-testid="user-page-open-lifecycle"
              onClick={() => setActiveDialog('lifecycle')}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">
                  {isInactive ? 'Reactivate account' : 'Inactivate account'}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Account lifecycle stays on your canonical user page now.
                </span>
              </span>
              <span className="text-sm font-medium text-muted-foreground">Open</span>
            </button>

            <button
              className="flex items-center justify-between rounded-[1.5rem] border border-destructive/30 bg-destructive/5 px-5 py-4 text-left transition hover:border-destructive/40"
              data-testid="user-page-open-delete"
              disabled={!isInactive || deleteMutation.isPending}
              onClick={() => setActiveDialog('delete')}
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
        description="Keep your personal name accurate for membership and account surfaces."
        onOpenChange={(open) => setActiveDialog(open ? 'profile' : null)}
        open={activeDialog === 'profile'}
        testId="user-page-profile-dialog"
        title="Edit profile"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">First name</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-first-name"
              disabled={disableProfileEditing}
              onChange={(event) => {
                profileMutation.reset();
                setProfileForm((current) => ({ ...current, firstName: event.target.value }));
              }}
              value={profileForm.firstName}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Last name</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-last-name"
              disabled={disableProfileEditing}
              onChange={(event) => {
                profileMutation.reset();
                setProfileForm((current) => ({ ...current, lastName: event.target.value }));
              }}
              value={profileForm.lastName}
            />
          </label>
        </div>

        {profileMutation.isError ? (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {extractErrorMessage(profileMutation.error)}
          </div>
        ) : null}
        {profileMutation.isSuccess ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Your profile was updated.
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="user-page-save-profile"
            disabled={
              disableProfileEditing
              || profileForm.firstName.trim().length === 0
              || profileForm.lastName.trim().length === 0
            }
            onClick={() => void profileMutation.mutateAsync().catch(() => undefined)}
            type="button"
          >
            {profileMutation.isPending ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </UserActionDialog>

      <UserActionDialog
        description="These settings control how dates, times, and locale-aware copy appear for you."
        onOpenChange={(open) => setActiveDialog(open ? 'preferences' : null)}
        open={activeDialog === 'preferences'}
        testId="user-page-preferences-dialog"
        title="Edit preferences"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Timezone</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-timezone"
              disabled={disablePreferencesEditing}
              onChange={(event) => {
                preferencesMutation.reset();
                setPreferencesForm((current) => ({ ...current, timezone: event.target.value }));
              }}
              placeholder="America/New_York"
              value={preferencesForm.timezone}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Locale</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-locale"
              disabled={disablePreferencesEditing}
              onChange={(event) => {
                preferencesMutation.reset();
                setPreferencesForm((current) => ({ ...current, locale: event.target.value }));
              }}
              placeholder="en-US"
              value={preferencesForm.locale}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Time format</span>
            <select
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-time-format"
              disabled={disablePreferencesEditing}
              onChange={(event) => {
                preferencesMutation.reset();
                setPreferencesForm((current) => ({
                  ...current,
                  timeFormat: event.target.value as AccountPreferencesFormState['timeFormat'],
                }));
              }}
              value={preferencesForm.timeFormat}
            >
              <option value="">System default</option>
              <option value="12H">12-hour</option>
              <option value="24H">24-hour</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Date format</span>
            <select
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-date-format"
              disabled={disablePreferencesEditing}
              onChange={(event) => {
                preferencesMutation.reset();
                setPreferencesForm((current) => ({
                  ...current,
                  dateFormat: event.target.value as AccountPreferencesFormState['dateFormat'],
                }));
              }}
              value={preferencesForm.dateFormat}
            >
              <option value="">System default</option>
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
              <option value="YMD">YYYY-MM-DD</option>
            </select>
          </label>
        </div>

        {preferencesMutation.isError ? (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {extractErrorMessage(preferencesMutation.error)}
          </div>
        ) : null}
        {preferencesMutation.isSuccess ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Your preferences were updated.
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="user-page-save-preferences"
            disabled={disablePreferencesEditing}
            onClick={() => void preferencesMutation.mutateAsync().catch(() => undefined)}
            type="button"
          >
            {preferencesMutation.isPending ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </UserActionDialog>

      <UserActionDialog
        description="Changing your password keeps the current session active and revokes your other refresh sessions."
        onOpenChange={(open) => setActiveDialog(open ? 'password' : null)}
        open={activeDialog === 'password'}
        testId="user-page-password-dialog"
        title="Change password"
      >
        <div className="space-y-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Current password</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-current-password"
              disabled={disablePasswordEditing}
              onChange={(event) => {
                passwordMutation.reset();
                setPasswordForm((current) => ({
                  ...current,
                  currentPassword: event.target.value,
                }));
              }}
              type="password"
              value={passwordForm.currentPassword}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">New password</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-new-password"
              disabled={disablePasswordEditing}
              onChange={(event) => {
                passwordMutation.reset();
                setPasswordForm((current) => ({
                  ...current,
                  newPassword: event.target.value,
                }));
              }}
              type="password"
              value={passwordForm.newPassword}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Confirm new password</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-confirm-password"
              disabled={disablePasswordEditing}
              onChange={(event) => {
                passwordMutation.reset();
                setPasswordForm((current) => ({
                  ...current,
                  confirmNewPassword: event.target.value,
                }));
              }}
              type="password"
              value={passwordForm.confirmNewPassword}
            />
          </label>
        </div>

        {passwordMutation.isError ? (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {extractErrorMessage(passwordMutation.error)}
          </div>
        ) : null}
        {passwordMutation.isSuccess ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Your password was changed.
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="user-page-save-password"
            disabled={
              disablePasswordEditing
              || passwordForm.currentPassword.length === 0
              || passwordForm.newPassword.length < 8
              || passwordForm.confirmNewPassword.length < 8
            }
            onClick={() => void passwordMutation.mutateAsync().catch(() => undefined)}
            type="button"
          >
            {passwordMutation.isPending ? 'Saving...' : 'Change password'}
          </button>
        </div>
      </UserActionDialog>

      <UserActionDialog
        description="Inactivate first, then delete permanently only after the account is inactive."
        onOpenChange={(open) => setActiveDialog(open ? 'lifecycle' : null)}
        open={activeDialog === 'lifecycle'}
        testId="user-page-lifecycle-dialog"
        title={isInactive ? 'Reactivate account' : 'Inactivate account'}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isInactive
              ? 'Reactivating your account restores normal PoolMaster usage immediately.'
              : 'Inactivating your account turns profile, preferences, and password management read-only until you reactivate or permanently delete the account.'}
          </p>
          {inactivateMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {extractErrorMessage(inactivateMutation.error)}
            </div>
          ) : null}
          {reactivateMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {extractErrorMessage(reactivateMutation.error)}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end">
          {isInactive ? (
            <button
              className="rounded-2xl border border-primary/30 bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-reactivate"
              disabled={reactivateMutation.isPending || deleteMutation.isPending}
              onClick={() => void reactivateMutation.mutateAsync().catch(() => undefined)}
              type="button"
            >
              {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate account'}
            </button>
          ) : (
            <button
              className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="user-page-inactivate"
              disabled={inactivateMutation.isPending || deleteMutation.isPending}
              onClick={() => void inactivateMutation.mutateAsync().catch(() => undefined)}
              type="button"
            >
              {inactivateMutation.isPending ? 'Inactivating...' : 'Inactivate account'}
            </button>
          )}
        </div>
      </UserActionDialog>

      <UserActionDialog
        description="Delete permanently only after the account is inactive and the email confirmation matches exactly."
        onOpenChange={(open) => {
          setActiveDialog(open ? 'delete' : null);
          if (!open) {
            setEmailConfirmation('');
            deleteMutation.reset();
          }
        }}
        open={activeDialog === 'delete'}
        testId="user-page-delete-dialog"
        title="Delete account"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This action will delete your account and related data permanently. Enter{' '}
            <span className="font-medium text-foreground">{user.email}</span> to continue.
          </p>
          <input
            autoComplete="email"
            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-destructive/40"
            data-testid="user-page-delete-confirmation"
            onChange={(event) => setEmailConfirmation(event.target.value)}
            placeholder="Enter your email exactly"
            type="email"
            value={emailConfirmation}
          />
          {deleteMutation.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {extractErrorMessage(deleteMutation.error)}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={deleteMutation.isPending}
            onClick={() => {
              setActiveDialog(null);
              setEmailConfirmation('');
              deleteMutation.reset();
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-2xl bg-destructive px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            data-testid="user-page-delete-submit"
            disabled={!confirmationMatches || deleteMutation.isPending}
            onClick={() => void deleteMutation.mutateAsync(user.email).catch(() => undefined)}
            type="button"
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete account'}
          </button>
        </div>
      </UserActionDialog>
    </section>
  );
}

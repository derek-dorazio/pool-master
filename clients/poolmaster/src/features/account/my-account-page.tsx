import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { formatUserName } from './user-name';

type AccountPreferencesFormState = {
  timezone: string;
  locale: string;
  timeFormat: '' | '12H' | '24H';
  dateFormat: '' | 'MDY' | 'DMY' | 'YMD';
};

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

export function MyAccountPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);
  const [isDeleteFlowOpen, setIsDeleteFlowOpen] = useState(false);
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
  }, [user]);

  const applyUserToSession = async (updatedUser: NonNullable<typeof user>) => {
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

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const response = await reactivateAccount();
      if (!response.data?.user) {
        throw response.error ?? new Error('Account reactivation response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      await applyUserToSession(updatedUser);
      setIsDeleteFlowOpen(false);
      setEmailConfirmation('');
    },
  });

  const inactivateMutation = useMutation({
    mutationFn: async () => {
      const response = await inactivateAccount();
      if (!response.data?.user) {
        throw response.error ?? new Error('Account inactivation response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      await applyUserToSession(updatedUser);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await deleteAccount({
        body: {
          email,
        },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('Account delete response is missing data.');
      }

      return response.data;
    },
    onSuccess: () => {
      setDeleteSuccess(true);
    },
  });

  if (!user) {
    return null;
  }

  const confirmationMatches = emailConfirmation.trim().toLowerCase() === user.email.toLowerCase();
  const isInactive = user.isActive === false;
  const memberSince = formatMemberSince(user.createdAt, user.dateFormat);
  const disableProfileEditing = isInactive || profileMutation.isPending;
  const disablePreferencesEditing = isInactive || preferencesMutation.isPending;
  const disablePasswordEditing = isInactive || passwordMutation.isPending;

  return (
    <section className="space-y-6" data-testid="my-account-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Profile
        </span>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">Manage your account</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Update your personal profile, password, and formatting preferences in one place. Squad
          identity will continue to handle your team-facing presence later.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="space-y-6">
          <div className="rounded-[1.75rem] border border-border bg-card p-6">
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
          </div>

          <section className="rounded-[1.75rem] border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">Profile</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Keep your personal name accurate for membership and account surfaces.
                </p>
              </div>
              {isInactive ? (
                <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Read only
                </span>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">First name</span>
                <input
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-account-first-name"
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
                  data-testid="my-account-last-name"
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

            <div className="mt-5">
              <button
                className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                data-testid="my-account-save-profile"
                disabled={
                  disableProfileEditing
                  || profileForm.firstName.trim().length === 0
                  || profileForm.lastName.trim().length === 0
                }
                onClick={() => void profileMutation.mutateAsync()}
                type="button"
              >
                {profileMutation.isPending ? 'Saving...' : 'Save profile'}
              </button>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">Preferences</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  These settings control how dates, times, and locale-aware copy appear for you.
                </p>
              </div>
              {isInactive ? (
                <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Read only
                </span>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Timezone</span>
                <input
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-account-timezone"
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
                  data-testid="my-account-locale"
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
                  data-testid="my-account-time-format"
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
                  data-testid="my-account-date-format"
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

            <div className="mt-5">
              <button
                className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                data-testid="my-account-save-preferences"
                disabled={disablePreferencesEditing}
                onClick={() => void preferencesMutation.mutateAsync()}
                type="button"
              >
                {preferencesMutation.isPending ? 'Saving...' : 'Save preferences'}
              </button>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">Password</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Changing your password keeps the current session active and revokes your other
                  refresh sessions.
                </p>
              </div>
              {isInactive ? (
                <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Read only
                </span>
              ) : null}
            </div>

            <div className="mt-5 space-y-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Current password</span>
                <input
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-account-current-password"
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
                  data-testid="my-account-new-password"
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
                  data-testid="my-account-confirm-password"
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

            <div className="mt-5">
              <button
                className="rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                data-testid="my-account-save-password"
                disabled={
                  disablePasswordEditing
                  || passwordForm.currentPassword.length === 0
                  || passwordForm.newPassword.length < 8
                  || passwordForm.confirmNewPassword.length < 8
                }
                onClick={() => void passwordMutation.mutateAsync()}
                type="button"
              >
                {passwordMutation.isPending ? 'Saving...' : 'Change password'}
              </button>
            </div>
          </section>
        </section>

        <section className="rounded-[1.75rem] border border-border bg-card p-6">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Lifecycle
            </div>
            <h3 className="mt-3 text-2xl font-semibold">Account lifecycle</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Inactivate first, then delete permanently only after the account is inactive.
            </p>
          </div>

          <div className="mt-6 space-y-5">
            <section className="rounded-[1.5rem] border border-border bg-background p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <h4 className="text-lg font-semibold">Account availability</h4>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    Active accounts can use PoolMaster normally. Inactive accounts become read-only
                    until they are reactivated or permanently deleted.
                  </p>
                </div>
                {isInactive ? (
                  <button
                    className="rounded-2xl border border-primary/30 bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="my-account-reactivate"
                    disabled={reactivateMutation.isPending || deleteMutation.isPending}
                    onClick={() => void reactivateMutation.mutateAsync()}
                    type="button"
                  >
                    {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate account'}
                  </button>
                ) : (
                  <button
                    className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="my-account-inactivate"
                    disabled={inactivateMutation.isPending || deleteMutation.isPending}
                    onClick={() => void inactivateMutation.mutateAsync()}
                    type="button"
                  >
                    {inactivateMutation.isPending ? 'Inactivating...' : 'Inactivate account'}
                  </button>
                )}
              </div>

              {inactivateMutation.isError ? (
                <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {extractErrorMessage(inactivateMutation.error)}
                </div>
              ) : null}
              {reactivateMutation.isError ? (
                <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {extractErrorMessage(reactivateMutation.error)}
                </div>
              ) : null}

              {isInactive ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Your account is inactive. Profile, preferences, and password are now read-only
                  until you reactivate or delete the account.
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Your account is active and editable.
                </div>
              )}
            </section>

            <section className="rounded-[1.5rem] border border-destructive/30 bg-destructive/5 p-5">
              {!deleteSuccess ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.24em] text-destructive/80">
                        Permanent delete
                      </div>
                      <h4 className="text-lg font-semibold text-foreground">Delete account</h4>
                      <p className="max-w-xl text-sm text-muted-foreground">
                        Delete is different from inactivate. It permanently removes your account
                        and related data and cannot be undone.
                      </p>
                    </div>
                    <button
                      className="rounded-2xl border border-destructive/40 bg-destructive px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                      data-testid="my-account-delete-trigger"
                      disabled={!isInactive || deleteMutation.isPending}
                      onClick={() => setIsDeleteFlowOpen(true)}
                      type="button"
                    >
                      Delete account
                    </button>
                  </div>

                  {!isInactive ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      Delete stays disabled until the account is inactive.
                    </p>
                  ) : null}

                  {isDeleteFlowOpen && isInactive ? (
                    <div
                      className="mt-5 space-y-4 rounded-[1.25rem] border border-destructive/30 bg-card p-5"
                      data-testid="my-account-delete-wizard"
                    >
                      <div className="space-y-2">
                        <h5 className="text-lg font-semibold">Delete account</h5>
                        <p className="text-sm text-muted-foreground">
                          This action will delete your account and all related data. This action is
                          irreversible. Are you sure you want to proceed?
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Are you sure you want to proceed? This action is irreversible. Please
                          enter <span className="font-medium text-foreground">{user.email}</span>{' '}
                          to continue.
                        </p>
                        <input
                          autoComplete="email"
                          className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-destructive/40"
                          data-testid="my-account-delete-confirmation"
                          onChange={(event) => setEmailConfirmation(event.target.value)}
                          placeholder="Enter your email exactly"
                          type="email"
                          value={emailConfirmation}
                        />
                      </div>

                      {deleteMutation.isError ? (
                        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                          {extractErrorMessage(deleteMutation.error)}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-3">
                        <button
                          className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            setIsDeleteFlowOpen(false);
                            setEmailConfirmation('');
                            deleteMutation.reset();
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="rounded-2xl bg-destructive px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                          data-testid="my-account-delete-submit"
                          disabled={!confirmationMatches || deleteMutation.isPending}
                          onClick={() => void deleteMutation.mutateAsync(user.email)}
                          type="button"
                        >
                          {deleteMutation.isPending ? 'Deleting...' : 'DELETE'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div
                  className="rounded-[1.25rem] border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"
                  data-testid="my-account-delete-success"
                >
                  <div className="text-lg font-semibold">Your account was deleted.</div>
                  <p className="mt-2 text-sm">
                    You no longer have access to PoolMaster with this account.
                  </p>
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
              )}
            </section>
          </div>
        </section>
      </div>
    </section>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteAccount, inactivateAccount } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';

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

export function MyAccountPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);
  const [isDeleteFlowOpen, setIsDeleteFlowOpen] = useState(false);
  const [emailConfirmation, setEmailConfirmation] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const user = auth.user;

  const inactivateMutation = useMutation({
    mutationFn: async () => {
      const response = await inactivateAccount();
      if (!response.data?.user) {
        throw response.error ?? new Error('Account inactivation response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: async (updatedUser) => {
      setSession(updatedUser);
      queryClient.setQueryData(['poolmaster', 'auth', 'me'], updatedUser);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'auth', 'me'] });
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

  return (
    <section className="space-y-6" data-testid="my-account-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          My Account
        </span>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">Manage your account</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          This personal area will grow into profile, password, and preferences management. The
          first live slice focuses on account lifecycle so members and commissioners can manage
          their own inactive-first delete flow.
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
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Display name
                </dt>
                <dd className="mt-1 text-base font-medium text-foreground">{user.displayName}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Email</dt>
                <dd className="mt-1 text-base font-medium text-foreground">{user.email}</dd>
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
                  {user.isRootAdmin ? 'Root admin' : 'Member'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-[1.75rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Profile &amp; preferences</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Future slices will let you update your name, email, password, and personal
              preferences here. This shell is in place now so account lifecycle lands in the right
              long-term home.
            </p>
            <div className="mt-4 rounded-[1.5rem] border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
              Profile editing, password changes, and app preferences will live here next.
            </div>
          </div>
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
                  <h4 className="text-lg font-semibold">Inactivate account</h4>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    Inactivation keeps your account record in place but ends normal product use and
                    unlocks the permanent delete flow.
                  </p>
                </div>
                <button
                  className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-account-inactivate"
                  disabled={isInactive || inactivateMutation.isPending || deleteMutation.isPending}
                  onClick={() => void inactivateMutation.mutateAsync()}
                  title={
                    isInactive
                      ? 'Your account is already inactive.'
                      : 'Inactivate first before permanent delete becomes available.'
                  }
                  type="button"
                >
                  {isInactive
                    ? 'Account inactive'
                    : inactivateMutation.isPending
                      ? 'Inactivating...'
                      : 'Inactivate account'}
                </button>
              </div>

              {inactivateMutation.isError ? (
                <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {extractErrorMessage(inactivateMutation.error)}
                </div>
              ) : null}

              {isInactive ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Your account is inactive. You can now continue with permanent delete if you still
                  want to remove it entirely.
                </div>
              ) : null}
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
                      title={
                        isInactive
                          ? 'Start the delete confirmation flow.'
                          : 'Inactivate your account first before permanent delete is available.'
                      }
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

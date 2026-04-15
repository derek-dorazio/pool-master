import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginRequestSchema, RegisterRequestSchema } from '@poolmaster/shared/dto';
import { loginUser, registerUser } from '@/lib/api';
import { InvitationContextCard } from '@/features/leagues/invitation-context-card';
import {
  fetchInvitationPreview,
  getInvitationPreviewQueryKey,
} from '@/features/leagues/invitation-preview';
import { parseRouteState } from '@/routes/route-state';
import { useSessionStore } from './session-store';

const loginFormSchema = LoginRequestSchema.extend({
  password: z.string().min(1, 'Password is required'),
});

const registerFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(50, 'First name is too long'),
  lastName: z.string().trim().min(1, 'Last name is required').max(50, 'Last name is too long'),
  email: RegisterRequestSchema.shape.email,
  password: RegisterRequestSchema.shape.password,
  confirmPassword: z.string().min(8, 'Please confirm your password'),
}).refine((values) => values.password === values.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords must match',
});

type LoginFormValues = z.infer<typeof loginFormSchema>;
type RegisterFormValues = z.infer<typeof registerFormSchema>;

function parseInviteCode(path: string | undefined) {
  if (!path) {
    return null;
  }

  const match = path.match(/^\/invite\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Something went wrong. Please try again.';
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

  return 'Something went wrong. Please try again.';
}

export function AuthHomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = useMemo(() => parseRouteState(location.state), [location.state]);
  const authPreference = routeState.authMode === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<'login' | 'register'>(authPreference);
  const [serverError, setServerError] = useState<string | null>(null);
  const user = useSessionStore((state) => state.user);
  const setSession = useSessionStore((state) => state.setSession);
  const destination = routeState.from ?? '/welcome';
  const inviteCode = useMemo(() => parseInviteCode(destination), [destination]);
  const invitePreviewQuery = useQuery({
    queryKey: getInvitationPreviewQueryKey(inviteCode ?? ''),
    queryFn: () => fetchInvitationPreview(inviteCode ?? ''),
    enabled: Boolean(inviteCode),
    retry: false,
  });
  const inviteContext = invitePreviewQuery.data ?? null;

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      confirmPassword: '',
    },
  });
  const isSubmitting = loginForm.formState.isSubmitting || registerForm.formState.isSubmitting;

  async function handleLogin(values: LoginFormValues) {
    setServerError(null);

    try {
      const response = await loginUser({
        body: values,
      });

      if (!response.data) {
        throw response.error ?? new Error('Login response is missing data.');
      }

      setSession(response.data.user);
      navigate(destination, { replace: true });
    } catch (error) {
      setServerError(extractErrorMessage(error));
    }
  }

  async function handleRegister(values: RegisterFormValues) {
    setServerError(null);

    try {
      const response = await registerUser({
        body: {
          email: values.email,
          password: values.password,
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Registration response is missing data.');
      }

      setSession(response.data.user);
      navigate(destination, { replace: true });
    } catch (error) {
      setServerError(extractErrorMessage(error));
    }
  }

  if (user) {
    return <Navigate replace to={destination} />;
  }

  return (
    <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            PoolMaster
          </span>
          <div className="space-y-3">
            <h2 className="max-w-xl text-4xl font-semibold tracking-tight">
              {inviteContext
                ? `You're almost inside ${inviteContext.league.name}.`
                : 'Run your league, manage your team, and keep every pool night organized.'}
            </h2>
            <p className="max-w-xl text-base text-muted-foreground">
              {inviteContext
                ? 'Sign in to join with your existing account, or create a new account and continue to the invitation confirmation step.'
                : 'PoolMaster gives commissioners one place to create leagues, invite members, manage teams, and grow into contests as new features come online.'}
            </p>
          </div>
          {inviteContext ? (
            <>
              <InvitationContextCard
                inviteCode={inviteContext.inviteCode}
                leagueName={inviteContext.league.name}
                message="This invitation is scoped to a specific league. After you sign in or create your account, you’ll review the invite and explicitly choose to join."
                title="League invite"
              />
            </>
          ) : (
            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-background p-4">
                Commissioners start by creating an account, landing in the app, and launching
                their first league with a memorable league code.
              </div>
              <div className="rounded-2xl border border-border bg-background p-4">
                Members join later through invitation, then manage their own team inside the
                league experience.
              </div>
            </div>
          )}
          {inviteCode && invitePreviewQuery.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              We couldn&apos;t load the invitation preview. You can still sign in or create an
              account, then return to the invitation link.
            </div>
          ) : null}
        </div>

        <div className="rounded-[2rem] border border-border bg-background p-6">
          <div className="flex gap-2 rounded-full border border-border bg-muted/40 p-1">
            <button
              className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
                mode === 'login' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
              }`}
              onClick={() => setMode('login')}
              type="button"
            >
              Sign in
            </button>
            <button
              data-testid="auth-register-tab"
              className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
                mode === 'register'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
              onClick={() => setMode('register')}
              type="button"
            >
              Create account
            </button>
          </div>

          {serverError ? (
            <div
              className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {serverError}
            </div>
          ) : null}

          {mode === 'login' ? (
            <form className="mt-6 space-y-4" onSubmit={loginForm.handleSubmit(handleLogin)}>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Email</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...loginForm.register('email')}
                  data-testid="auth-login-email"
                  placeholder="you@example.com"
                  type="email"
                />
                {loginForm.formState.errors.email ? (
                  <span className="text-sm text-destructive">
                    {loginForm.formState.errors.email.message}
                  </span>
                ) : null}
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Password</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...loginForm.register('password')}
                  data-testid="auth-login-password"
                  placeholder="Enter your password"
                  type="password"
                />
                {loginForm.formState.errors.password ? (
                  <span className="text-sm text-destructive">
                    {loginForm.formState.errors.password.message}
                  </span>
                ) : null}
              </label>

              <button
                className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="auth-login-submit"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={registerForm.handleSubmit(handleRegister)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">First name</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                    {...registerForm.register('firstName')}
                    data-testid="auth-register-first-name"
                    placeholder="Taylor"
                    type="text"
                  />
                  {registerForm.formState.errors.firstName ? (
                    <span className="text-sm text-destructive">
                      {registerForm.formState.errors.firstName.message}
                    </span>
                  ) : null}
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium">Last name</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                    {...registerForm.register('lastName')}
                    data-testid="auth-register-last-name"
                    placeholder="Commissioner"
                    type="text"
                  />
                  {registerForm.formState.errors.lastName ? (
                    <span className="text-sm text-destructive">
                      {registerForm.formState.errors.lastName.message}
                    </span>
                  ) : null}
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Email</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...registerForm.register('email')}
                  data-testid="auth-register-email"
                  placeholder="you@example.com"
                  type="email"
                />
                {registerForm.formState.errors.email ? (
                  <span className="text-sm text-destructive">
                    {registerForm.formState.errors.email.message}
                  </span>
                ) : null}
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Create password</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...registerForm.register('password')}
                  data-testid="auth-register-password"
                  placeholder="Create a password"
                  type="password"
                />
                {registerForm.formState.errors.password ? (
                  <span className="text-sm text-destructive">
                    {registerForm.formState.errors.password.message}
                  </span>
                ) : null}
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Confirm password</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...registerForm.register('confirmPassword')}
                  data-testid="auth-register-confirm-password"
                  placeholder="Re-enter your password"
                  type="password"
                />
                {registerForm.formState.errors.confirmPassword ? (
                  <span className="text-sm text-destructive">
                    {registerForm.formState.errors.confirmPassword.message}
                  </span>
                ) : null}
              </label>

              <button
                className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="auth-register-submit"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Creating account...' : 'Register and continue'}
              </button>
            </form>
          )}

          <p className="mt-5 text-sm text-muted-foreground">
            {inviteContext
              ? 'Registration signs you in first, then returns you to this league invitation so you can confirm the join explicitly.'
              : 'Registration signs you in and lands you on your normal app home. If you have no leagues yet, that landing page becomes your first-time commissioner welcome state.'}
          </p>
          <Link
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            to={inviteCode ? destination : '/welcome'}
          >
            {inviteCode ? 'Back to invitation' : 'Continue to welcome'}
          </Link>
        </div>
      </div>
    </section>
  );
}

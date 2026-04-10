import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { LoginRequestSchema, RegisterRequestSchema } from '@poolmaster/shared/dto';
import { loginUser, registerUser } from '@/lib/api';
import { useSessionStore } from './session-store';

const loginFormSchema = LoginRequestSchema.extend({
  password: z.string().min(1, 'Password is required'),
});

const registerFormSchema = RegisterRequestSchema.extend({
  displayName: z.string().min(1, 'Display name is required'),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;
type RegisterFormValues = z.infer<typeof registerFormSchema>;

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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setMemberSession = useSessionStore((state) => state.setMemberSession);

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
      displayName: '',
    },
  });

  async function handleLogin(values: LoginFormValues) {
    setServerError(null);
    setIsSubmitting(true);

    try {
      const response = await loginUser({
        body: values,
      });

      if (!response.data) {
        throw response.error ?? new Error('Login response is missing data.');
      }

      setMemberSession({
        id: response.data.user.id,
        email: response.data.user.email,
        displayName: response.data.user.displayName,
      });
    } catch (error) {
      setServerError(extractErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegister(values: RegisterFormValues) {
    setServerError(null);
    setIsSubmitting(true);

    try {
      const response = await registerUser({
        body: values,
      });

      if (!response.data) {
        throw response.error ?? new Error('Registration response is missing data.');
      }

      setMemberSession({
        id: response.data.user.id,
        email: response.data.user.email,
        displayName: response.data.user.displayName,
      });
    } catch (error) {
      setServerError(extractErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
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
              One web app for members, commissioners, and future root admins.
            </h2>
            <p className="max-w-xl text-base text-muted-foreground">
              The rebuilt PoolMaster client stays aligned to generated SDK contracts and the
              refactored backend model from day one.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background p-4">
              Member flows start with league browsing, invitations, contests, and entries.
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              Commissioner and root-admin surfaces will live in this same shell with role-aware
              navigation.
            </div>
          </div>
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
            <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={registerForm.handleSubmit(handleRegister)}>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Display name</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...registerForm.register('displayName')}
                  placeholder="League commissioner"
                  type="text"
                />
                {registerForm.formState.errors.displayName ? (
                  <span className="text-sm text-destructive">
                    {registerForm.formState.errors.displayName.message}
                  </span>
                ) : null}
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium">Email</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...registerForm.register('email')}
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
                <span className="text-sm font-medium">Password</span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  {...registerForm.register('password')}
                  placeholder="Choose a password"
                  type="password"
                />
                {registerForm.formState.errors.password ? (
                  <span className="text-sm text-destructive">
                    {registerForm.formState.errors.password.message}
                  </span>
                ) : null}
              </label>

              <button
                className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Creating account...' : 'Create account'}
              </button>
            </form>
          )}

          <p className="mt-5 text-sm text-muted-foreground">
            Role-specific navigation appears after sign-in. Root-admin pages will be rebuilt in
            this same app instead of returning to the retired admin frontend.
          </p>
          <Link className="mt-3 inline-block text-sm font-medium text-primary hover:underline" to="/leagues">
            Continue to leagues
          </Link>
        </div>
      </div>
    </section>
  );
}

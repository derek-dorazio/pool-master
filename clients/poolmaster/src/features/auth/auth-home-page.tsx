import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  LoginRequestSchema,
  RegisterRequestSchema,
} from "@poolmaster/shared/dto";
import { loginUser, registerUser } from "@/lib/api";
import { InvitationContextCard } from "@/features/leagues/invitation-context-card";
import {
  Alert,
  Button,
  FormField,
  Input,
  SegmentedControl,
  Tile,
} from "@/features/shared/ui";
import {
  fetchInvitationPreview,
  getInvitationPreviewQueryKey,
} from "@/features/leagues/invitation-preview";
import {
  fetchTeamOwnerInvitationPreview,
  getTeamOwnerInvitationPreviewQueryKey,
} from "@/features/teams/team-owner-invitation-preview";
import { parseRouteState } from "@/routes/route-state";
import { extractErrorMessage } from "@/lib/errors";
import { useLogger } from "@/lib/logger";
import { useSessionStore } from "./session-store";

const loginFormSchema = LoginRequestSchema.extend({
  password: z.string().min(1, "Password is required"),
});

const registerFormSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, "First name is required")
      .max(50, "First name is too long"),
    lastName: z
      .string()
      .trim()
      .min(1, "Last name is required")
      .max(50, "Last name is too long"),
    username: RegisterRequestSchema.shape.username,
    email: RegisterRequestSchema.shape.email,
    password: RegisterRequestSchema.shape.password,
    confirmPassword: z.string().min(8, "Please confirm your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match",
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

function parseTeamInviteCode(path: string | undefined) {
  if (!path) {
    return null;
  }

  const match = path.match(/^\/team-invite\/([^/?#]+)/);
  return match?.[1] ?? null;
}

type PostAuthUser = {
  isRootAdmin?: boolean | null;
};

export function resolvePostAuthDestination(
  user: PostAuthUser,
  routeState: { from?: string },
): string {
  if (routeState.from) {
    return routeState.from;
  }
  if (user.isRootAdmin) {
    return "/manage";
  }
  return "/welcome";
}

function isUnexpectedAuthError(error: unknown): boolean {
  return error instanceof Error;
}

export function AuthHomePage() {
  const logger = useLogger().child({
    feature: "auth-home-page",
  });
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = useMemo(
    () => parseRouteState(location.state),
    [location.state],
  );
  const authPreference =
    routeState.authMode === "register" ? "register" : "login";
  const [mode, setMode] = useState<"login" | "register">(authPreference);
  const [serverError, setServerError] = useState<string | null>(null);
  const user = useSessionStore((state) => state.user);
  const setSession = useSessionStore((state) => state.setSession);
  const destination = routeState.from ?? "/welcome";
  const inviteCode = useMemo(() => parseInviteCode(destination), [destination]);
  const teamInviteCode = useMemo(
    () => parseTeamInviteCode(destination),
    [destination],
  );
  const invitePreviewQuery = useQuery({
    queryKey: getInvitationPreviewQueryKey(inviteCode ?? ""),
    queryFn: () => fetchInvitationPreview(inviteCode ?? ""),
    enabled: Boolean(inviteCode),
    retry: false,
  });
  const teamInvitePreviewQuery = useQuery({
    queryKey: getTeamOwnerInvitationPreviewQueryKey(teamInviteCode ?? ""),
    queryFn: () => fetchTeamOwnerInvitationPreview(teamInviteCode ?? ""),
    enabled: Boolean(teamInviteCode),
    retry: false,
  });
  const inviteContext = invitePreviewQuery.data ?? null;
  const teamInviteContext = teamInvitePreviewQuery.data ?? null;

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      firstName: "",
      lastName: "",
      confirmPassword: "",
    },
  });
  const isSubmitting =
    loginForm.formState.isSubmitting || registerForm.formState.isSubmitting;
  const [hasEditedUsername, setHasEditedUsername] = useState(false);
  const watchedEmail = registerForm.watch("email");

  useEffect(() => {
    if (hasEditedUsername) {
      return;
    }

    registerForm.setValue("username", watchedEmail.trim().toLowerCase(), {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [hasEditedUsername, registerForm, watchedEmail]);

  useEffect(() => {
    if (!inviteCode || !invitePreviewQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: "auth.leagueInvitePreview.failed",
        data: {
          destination,
          inviteCode,
        },
        err: invitePreviewQuery.error,
      },
      "League invitation preview failed to load on the auth page",
    );
  }, [
    destination,
    inviteCode,
    invitePreviewQuery.error,
    invitePreviewQuery.isError,
    logger,
  ]);

  useEffect(() => {
    if (!teamInviteCode || !teamInvitePreviewQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: "auth.teamInvitePreview.failed",
        data: {
          destination,
          inviteCode: teamInviteCode,
        },
        err: teamInvitePreviewQuery.error,
      },
      "Team invitation preview failed to load on the auth page",
    );
  }, [
    destination,
    logger,
    teamInviteCode,
    teamInvitePreviewQuery.error,
    teamInvitePreviewQuery.isError,
  ]);

  async function handleLogin(values: LoginFormValues) {
    setServerError(null);
    logger.debug(
      {
        action: "auth.login.started",
        data: {
          destination,
          hasInvitation: Boolean(inviteCode || teamInviteCode),
        },
      },
      "Submitting login request",
    );

    try {
      const response = await loginUser({
        body: values,
      });

      if (!response.data) {
        throw response.error ?? new Error("Login response is missing data.");
      }

      setSession(response.data.user);
      const loginDestination = resolvePostAuthDestination(
        response.data.user,
        routeState,
      );
      logger.info(
        {
          action: "auth.login.succeeded",
          data: {
            destination: loginDestination,
            userId: response.data.user.id,
            isRootAdmin: response.data.user.isRootAdmin,
            hasInvitation: Boolean(inviteCode || teamInviteCode),
          },
        },
        "Completed login flow",
      );
      navigate(loginDestination, { replace: true });
    } catch (error) {
      const logPayload = {
        action: "auth.login.failed",
        data: {
          destination,
          hasInvitation: Boolean(inviteCode || teamInviteCode),
        },
        err: error,
      };

      if (isUnexpectedAuthError(error)) {
        logger.error(logPayload, "Login failed unexpectedly");
      } else {
        logger.warn(logPayload, "Login request was rejected");
      }
      setServerError(extractErrorMessage(error));
    }
  }

  async function handleRegister(values: RegisterFormValues) {
    setServerError(null);
    logger.debug(
      {
        action: "auth.register.started",
        data: {
          destination,
          hasInvitation: Boolean(inviteCode || teamInviteCode),
        },
      },
      "Submitting registration request",
    );

    try {
      const response = await registerUser({
        body: {
          username: values.username.trim().toLowerCase(),
          email: values.email,
          password: values.password,
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
        },
      });

      if (!response.data) {
        throw (
          response.error ?? new Error("Registration response is missing data.")
        );
      }

      setSession(response.data.user);
      const registerDestination = resolvePostAuthDestination(
        response.data.user,
        routeState,
      );
      logger.info(
        {
          action: "auth.register.succeeded",
          data: {
            destination: registerDestination,
            userId: response.data.user.id,
            isRootAdmin: response.data.user.isRootAdmin,
            hasInvitation: Boolean(inviteCode || teamInviteCode),
          },
        },
        "Completed registration flow",
      );
      navigate(registerDestination, { replace: true });
    } catch (error) {
      const logPayload = {
        action: "auth.register.failed",
        data: {
          destination,
          hasInvitation: Boolean(inviteCode || teamInviteCode),
        },
        err: error,
      };

      if (isUnexpectedAuthError(error)) {
        logger.error(logPayload, "Registration failed unexpectedly");
      } else {
        logger.warn(logPayload, "Registration request was rejected");
      }
      setServerError(extractErrorMessage(error));
    }
  }

  if (user) {
    return (
      <Navigate replace to={resolvePostAuthDestination(user, routeState)} />
    );
  }

  return (
    <Tile className="shadow-lg" padding="lg" radius="xl">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <span className="inline-flex rounded-pill border border-border px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.24em] text-muted-foreground">
            Ultimate Office Pool Manager
          </span>
          <div className="space-y-3">
            <h2 className="max-w-xl font-display text-4xl font-black tracking-normal">
              {inviteContext
                ? `You're almost inside ${inviteContext.league.name}.`
                : teamInviteContext
                  ? `You're almost inside ${teamInviteContext.league.name}.`
                  : "Run your league, manage your team, and keep every pool night organized."}
            </h2>
            <p className="max-w-xl text-base text-muted-foreground">
              {inviteContext
                ? "Sign in to join with your existing account, or create a new account and continue to the invitation confirmation step."
                : teamInviteContext
                  ? `Sign in to join ${teamInviteContext.team.name} as a co-owner, or create a new account and continue to the invitation confirmation step.`
                  : "Prime Time Commissioner gives commissioners one place to create leagues, invite members, manage teams, and grow into contests as new features come online."}
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
          ) : teamInviteContext ? (
            <InvitationContextCard
              inviteCode={teamInviteContext.inviteCode}
              leagueName={teamInviteContext.league.name}
              message={`This invitation adds you as a co-owner of ${teamInviteContext.team.name}. After you sign in or create your account, you’ll review the team invitation and explicitly accept it.`}
              title="Team co-owner invite"
            />
          ) : (
            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <Tile padding="sm" radius="md" variant="subtle">
                Commissioners start by creating an account, landing in the app,
                and launching their first league with a memorable league code.
              </Tile>
              <Tile padding="sm" radius="md" variant="subtle">
                Members join later through invitation, then manage their own
                team inside the league experience.
              </Tile>
            </div>
          )}
          {(inviteCode && invitePreviewQuery.isError) ||
          (teamInviteCode && teamInvitePreviewQuery.isError) ? (
            <Alert tone="danger">
              We couldn&apos;t load the invitation preview. You can still sign
              in or create an account, then return to the invitation link.
            </Alert>
          ) : null}
        </div>

        <Tile padding="md" radius="xl" variant="subtle">
          <SegmentedControl
            aria-label="Authentication mode"
            onChange={(nextMode) =>
              setMode(nextMode === "register" ? "register" : "login")
            }
            options={[
              { label: "Sign in", value: "login" },
              { label: "Create account", value: "register" },
            ]}
            value={mode}
          />

          {serverError ? (
            <Alert className="mt-4" tone="danger">
              {serverError}
            </Alert>
          ) : null}

          {mode === "login" ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={loginForm.handleSubmit(handleLogin)}
            >
              <FormField
                error={loginForm.formState.errors.identifier?.message}
                label="Username or email"
              >
                <Input
                  {...loginForm.register("identifier")}
                  data-testid="auth-login-identifier"
                  placeholder="yourname or you@example.com"
                  type="text"
                />
              </FormField>

              <FormField
                error={loginForm.formState.errors.password?.message}
                label="Password"
              >
                <Input
                  {...loginForm.register("password")}
                  data-testid="auth-login-password"
                  placeholder="Enter your password"
                  type="password"
                />
              </FormField>

              <Button
                className="w-full"
                data-testid="auth-login-submit"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={registerForm.handleSubmit(handleRegister)}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  error={registerForm.formState.errors.firstName?.message}
                  label="First name"
                >
                  <Input
                    {...registerForm.register("firstName")}
                    data-testid="auth-register-first-name"
                    placeholder="Taylor"
                    type="text"
                  />
                </FormField>

                <FormField
                  error={registerForm.formState.errors.lastName?.message}
                  label="Last name"
                >
                  <Input
                    {...registerForm.register("lastName")}
                    data-testid="auth-register-last-name"
                    placeholder="Commissioner"
                    type="text"
                  />
                </FormField>
              </div>

              <FormField
                error={registerForm.formState.errors.email?.message}
                label="Email"
              >
                <Input
                  {...registerForm.register("email")}
                  data-testid="auth-register-email"
                  placeholder="you@example.com"
                  type="email"
                />
              </FormField>

              <FormField
                error={registerForm.formState.errors.username?.message}
                label="Username"
              >
                <Input
                  {...registerForm.register("username", {
                    onChange: () => setHasEditedUsername(true),
                  })}
                  data-testid="auth-register-username"
                  placeholder="yourname"
                  type="text"
                />
              </FormField>

              <FormField
                error={registerForm.formState.errors.password?.message}
                label="Create password"
              >
                <Input
                  {...registerForm.register("password")}
                  data-testid="auth-register-password"
                  placeholder="Create a password"
                  type="password"
                />
              </FormField>

              <FormField
                error={registerForm.formState.errors.confirmPassword?.message}
                label="Confirm password"
              >
                <Input
                  {...registerForm.register("confirmPassword")}
                  data-testid="auth-register-confirm-password"
                  placeholder="Re-enter your password"
                  type="password"
                />
              </FormField>

              <Button
                className="w-full"
                data-testid="auth-register-submit"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Creating account..." : "Register and continue"}
              </Button>
            </form>
          )}

          <p className="mt-5 text-sm text-muted-foreground">
            {inviteContext
              ? "Registration signs you in first, then returns you to this league invitation so you can confirm the join explicitly."
              : teamInviteContext
                ? "Registration signs you in first, then returns you to this team invitation so you can confirm the co-owner join explicitly."
                : "Registration signs you in and lands you on your normal app home. If you have no leagues yet, that landing page becomes your first-time commissioner welcome state."}
          </p>
          <Link
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            to={inviteCode || teamInviteCode ? destination : "/welcome"}
          >
            {inviteCode || teamInviteCode
              ? "Back to invitation"
              : "Continue to welcome"}
          </Link>
        </Tile>
      </div>
    </Tile>
  );
}

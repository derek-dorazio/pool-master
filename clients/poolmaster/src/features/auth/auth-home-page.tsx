import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useLocation, useNavigate } from "react-router";
import { LoginRequestSchema } from "@poolmaster/shared/dto";
import { loginUser } from "@/lib/api";
import { InvitationContextCard } from "@/features/leagues/invitation-context-card";
import {
  Notice,
  Button,
  ErrorState,
  FormField,
  Heading,
  Input,
  LinkButton,
  PasswordInput,
  refetchFailed,
  TabbedCard,
} from "@/features/shared/ui";
import { HowItWorksSteps } from "@/features/contest-types/how-it-works";
import {
  joinLeagueHeadline,
  joinTeamHeadline,
  SIGN_IN_HEADLINE,
} from "@/features/contest-types/public-headlines";
import {
  fetchInvitationPreview,
  getInvitationPreviewQueryKey,
} from "@/features/leagues/invitation-preview";
import {
  fetchTeamOwnerInvitationPreview,
  getTeamOwnerInvitationPreviewQueryKey,
} from "@/features/teams/team-owner-invitation-preview";
import { parseRouteState } from "@/routes/route-state";
import { resolvePostAuthDestination } from "./post-auth-destination";
import { ApiError, extractErrorMessage, throwApiError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { setAuthSessionUser, type AuthSessionUser } from "./auth-session-cache";
import { useAuth } from "./auth-context";
import { FORGOT_PASSWORD_PATH } from "./auth-paths";
import { SignUpForm } from "./sign-up-form";
import { eventPageCopy } from "@/features/event-pages/event-page-copy";
import { HOW_TO_PLAY_PATH } from "@/features/event-pages/event-page-paths";
import { parseStartReturnPath } from "@/features/event-pages/start-path";

const loginFormSchema = LoginRequestSchema.extend({
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

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

function isUnexpectedAuthError(error: unknown): boolean {
  // ApiError wraps every SDK rejection (see throwApiError) so it is always
  // `instanceof Error`; a plain `error instanceof Error` check no longer
  // distinguishes an expected API rejection from a genuine unexpected
  // exception the way it did when SDK errors were thrown as plain objects.
  return !(error instanceof ApiError);
}

export function AuthHomePage() {
  const logger = getLogger().child({
    feature: "auth-home-page",
  });
  const queryClient = useQueryClient();
  const auth = useAuth();
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
  const user = auth.user;
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
  // An event page's start (#1008) waits behind sign-up; the banner says what it is starting.
  const startRequest = useMemo(() => parseStartReturnPath(destination), [destination]);
  const inviteContext = invitePreviewQuery.data ?? null;
  const teamInviteContext = teamInvitePreviewQuery.data ?? null;

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const isSubmitting = loginForm.formState.isSubmitting;

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
        throwApiError(response.error, "Login response is missing data.");
      }

      setAuthSessionUser(queryClient, response.data.user);
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
      void navigate(loginDestination, { replace: true });
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
      setServerError(extractErrorMessage(error instanceof Error ? error : null));
    }
  }

  function handleRegistered(user: AuthSessionUser) {
    void navigate(resolvePostAuthDestination(user, routeState), { replace: true });
  }

  if (user) {
    return (
      <Navigate replace to={resolvePostAuthDestination(user, routeState)} />
    );
  }

  const isInvite = Boolean(inviteContext ?? teamInviteContext);
  const headline = inviteContext
    ? joinLeagueHeadline(inviteContext.league.name)
    : teamInviteContext
      ? joinTeamHeadline(teamInviteContext.team.name, teamInviteContext.league.name)
      : SIGN_IN_HEADLINE;
  // A league or co-owner invite shows the league it leads to where the steps would be.
  const besideTheForm = inviteContext ? (
    <InvitationContextCard
      inviteCode={inviteContext.inviteCode}
      leagueName={inviteContext.league.name}
      title="League invite"
    />
  ) : teamInviteContext ? (
    <InvitationContextCard
      inviteCode={teamInviteContext.inviteCode}
      leagueName={teamInviteContext.league.name}
      title="Co-owner invite"
    />
  ) : (
    <div className="space-y-4" data-testid="auth-how-it-works">
      <HowItWorksSteps testId="auth-steps" />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <LinkButton data-testid="auth-how-to-play" size="sm" to={HOW_TO_PLAY_PATH} variant="link">How to play</LinkButton>
        <LinkButton data-testid="auth-plans" size="sm" to="/plans" variant="link">Plans</LinkButton>
      </div>
    </div>
  );

  const loginView = (
    <form
      className="space-y-4"
      onSubmit={(e) => void loginForm.handleSubmit(handleLogin)(e)}
    >
      {serverError ? (
        <Notice data-testid="auth-server-error" tone="danger">
          {serverError}
        </Notice>
      ) : null}
      <FormField
        error={loginForm.formState.errors.identifier?.message}
        label="Username or email"
      >
        <Input
          {...loginForm.register("identifier")}
          autoComplete="username"
          data-testid="auth-login-identifier"
          type="text"
        />
      </FormField>

      <FormField
        error={loginForm.formState.errors.password?.message}
        label="Password"
      >
        <PasswordInput
          {...loginForm.register("password")}
          autoComplete="current-password"
          data-testid="auth-login-password"
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
      <LinkButton data-testid="auth-forgot-password" size="sm" to={FORGOT_PASSWORD_PATH} variant="link">
        Forgot password?
      </LinkButton>
    </form>
  );

  return (
    // On a phone the form comes straight after the headline (after an invite's league card),
    // and the steps follow it; on a wide screen the steps or the league sit under the headline,
    // beside the form.
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:grid-rows-[auto_1fr] lg:gap-x-12"
      data-testid="auth-home-page"
    >
      <Heading className="lg:col-start-1 lg:row-start-1" level={1} variant="hero">
        {headline}
      </Heading>

      {isInvite ? <div className="lg:col-start-1 lg:row-start-2">{besideTheForm}</div> : null}

      <div className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {startRequest && !isInvite ? (
          <Notice data-testid="auth-start-banner" tone="info">
            {`You're starting a ${eventPageCopy(startRequest).name} pool`}
          </Notice>
        ) : null}
        {(inviteCode && invitePreviewQuery.isError) ||
        (teamInviteCode && teamInvitePreviewQuery.isError) ? (
          <ErrorState
            body="We couldn't load the invitation preview. You can still sign in or create an account, then return to the invitation link."
            onRetry={refetchFailed(invitePreviewQuery, teamInvitePreviewQuery)}
            testId="auth-invite-preview-error"
          />
        ) : null}
        <TabbedCard
          aria-label="Sign in or create account"
          onValueChange={(nextMode) => setMode(nextMode === "register" ? "register" : "login")}
          radius="panel"
          tabs={[
            { content: loginView, label: "Sign in", testId: "auth-mode-login", value: "login" },
            {
              content: <SignUpForm onRegistered={handleRegistered} />,
              label: "Create account",
              testId: "auth-mode-register",
              value: "register",
            },
          ]}
          testId="auth-card"
          value={mode}
        />
      </div>

      {isInvite ? null : <div className="lg:col-start-1 lg:row-start-2">{besideTheForm}</div>}
    </div>
  );
}

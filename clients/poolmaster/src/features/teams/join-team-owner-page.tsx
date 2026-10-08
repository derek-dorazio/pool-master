import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useNavigate, useParams } from 'react-router-dom';
import { RegisterWithTeamOwnerInvitationRequestSchema } from '@poolmaster/shared/dto';
import { acceptTeamOwnerInvitation, registerWithTeamOwnerInvitation } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { setAuthSessionUser } from '@/features/auth/auth-session-cache';
import { InvitationContextCard } from '@/features/leagues/invitation-context-card';
import { describeUnusableInvitation } from '@/features/leagues/unusable-invitation';
import {
  Button,
  Chip,
  FormField,
  Input,
  LinkButton,
  PublicInviteJoinPage,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import {
  buildLeaguePath,
  buildLeagueTeamPath,
  buildTeamInvitePath,
  rememberRecentLeagueCode,
} from '@/features/leagues/league-routing';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';
import {
  fetchTeamOwnerInvitationPreview,
  getTeamOwnerInvitationPreviewQueryKey,
} from './team-owner-invitation-preview';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';

/*
 * #217 — the invited stranger registers here rather than being sent away.
 *
 * `inviteCode` is supplied by the route, and there is deliberately no email field: the account is
 * created with the address the commissioner invited, which the server reads off the invitation. A
 * squad-owner invitation grants league membership, so honouring an address typed in here would let
 * a forwarded invite link admit an unintended person.
 */
const RegisterFormSchema = RegisterWithTeamOwnerInvitationRequestSchema.omit({ inviteCode: true });
type RegisterFormValues = z.infer<typeof RegisterFormSchema>;

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'We could not accept this team invitation. Please try again.';
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

  return 'We could not accept this team invitation. Please try again.';
}

export function JoinTeamOwnerPage() {
  // Memoised: `child()` returns a new logger on every call, and the effects below depend on it,
  // so a logger built during render re-ran them — re-logging the invitation — on every render.
  const logger = useMemo(() => getLogger().child({
    feature: 'join-team-owner-page',
  }), []);
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const invitationQuery = useQuery({
    queryKey: getTeamOwnerInvitationPreviewQueryKey(inviteCode),
    queryFn: () => fetchTeamOwnerInvitationPreview(inviteCode),
    enabled: Boolean(inviteCode),
    retry: false,
  });

  useEffect(() => {
    if (!invitationQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'teamInvite.preview.failed',
        data: {
          inviteCode,
        },
        err: invitationQuery.error,
      },
      'Team-owner invitation preview failed to load',
    );
  }, [inviteCode, invitationQuery.error, invitationQuery.isError, logger]);

  useEffect(() => {
    if (!invitationQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'teamInvite.preview.loaded',
        data: {
          inviteCode,
          leagueCode: invitationQuery.data.league.leagueCode,
          teamId: invitationQuery.data.team.id,
          isAuthenticated,
        },
      },
      'Team-owner invitation preview loaded',
    );
  }, [inviteCode, invitationQuery.data, isAuthenticated, logger]);

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(RegisterFormSchema),
    mode: 'onSubmit',
    defaultValues: { username: '', password: '', firstName: '', lastName: '' },
  });

  /**
   * #217 — register and join in one request.
   *
   * This replaced a dead end: the page told an invited stranger to "sign in or create an account
   * first, then come back", but `acceptTeamOwnerInvitation` needs a session, so there was no way
   * through for somebody without an account. One request now registers them with the invited
   * email, joins them to the league and the squad, and returns a session.
   */
  const registerMutation = useInvalidatingMutation({
    mutationFn: async (values: RegisterFormValues) => {
      const response = await registerWithTeamOwnerInvitation({
        body: {
          inviteCode,
          username: values.username.trim().toLowerCase(),
          password: values.password,
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
        },
      });
      if (!response.data?.user) {
        throwApiError(response.error, 'Team-owner registration response is missing data.');
      }

      return response.data;
    },
    onSuccess: (data) => {
      // The session arrives with the response, so seed the cache rather than making the new
      // member's first action a round trip to discover who they are.
      setAuthSessionUser(queryClient, data.user);
      logger.info(
        {
          action: 'teamInvite.register.succeeded',
          data: {
            inviteCode,
            userId: data.user.id,
            leagueCode: invitationQuery.data?.league.leagueCode ?? null,
          },
        },
        'Registered an invited co-owner and joined their team',
      );
      const leagueCode = invitationQuery.data?.league.leagueCode;
      if (leagueCode) {
        rememberRecentLeagueCode(leagueCode);
        navigate(buildLeagueTeamPath(leagueCode), { replace: true });
      }
    },
    invalidates: [
      QueryKeys.leagues.list,
      QueryKeys.leagueTeams.all,
    ],
    onError: (error) => {
      logger.warn(
        {
          action: 'teamInvite.register.failed',
          data: { inviteCode },
          err: error,
        },
        'Failed to register an invited co-owner',
      );
    },
  });

  const acceptMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await acceptTeamOwnerInvitation({ body: { inviteCode } });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Team-owner invitation acceptance response is missing data.');
      }

      return response.data.invitation;
    },
    onMutate: () => {
      logger.debug(
        {
          action: 'teamInvite.accept.started',
          data: {
            inviteCode,
          },
        },
        'Starting team-owner invitation acceptance',
      );
    },
    onSuccess: () => {
      logger.info(
        {
          action: 'teamInvite.accept.succeeded',
          data: {
            inviteCode,
            leagueCode: invitationQuery.data?.league.leagueCode ?? null,
            teamId: invitationQuery.data?.team.id ?? null,
          },
        },
        'Accepted team-owner invitation',
      );
      const leagueCode = invitationQuery.data?.league.leagueCode;
      if (leagueCode) {
        rememberRecentLeagueCode(leagueCode);
        navigate(buildLeagueTeamPath(leagueCode));
      }
    },
    invalidates: [
      QueryKeys.leagues.list,
      QueryKeys.leagueTeams.all,
    ],
    onError: (error) => {
      const payload = {
        action: 'teamInvite.accept.failed',
        data: {
          inviteCode,
        },
        err: error,
      };

      // ApiError wraps every SDK rejection (see throwApiError) so it is
      // always `instanceof Error`; check for it explicitly rather than
      // `error instanceof Error` to keep distinguishing an expected API
      // rejection from a genuine unexpected exception.
      if (!(error instanceof ApiError)) {
        logger.error(payload, 'Team-owner invitation acceptance failed unexpectedly');
      } else {
        logger.warn(payload, 'Team-owner invitation acceptance was rejected');
      }
    },
  });

  const redirectMessage = useMemo(() => {
    if (!inviteCode) {
      return 'This team invitation link is missing a code.';
    }

    if (!isAuthenticated) {
      // #217 — no longer a dead end. The registration form below completes the join in one step;
      // this line only sets the heading's tone.
      return 'Create your account to join this team, or sign in if you already have one.';
    }

    return null;
  }, [inviteCode, isAuthenticated]);

  const selectedIcon = invitationQuery.data
    ? getTeamIconOption(invitationQuery.data.team.iconKey)
    : null;
  const unusableInvitationMessage = describeUnusableInvitation(invitationQuery.data?.status);

  if (redirectMessage) {
    return (
      <PublicInviteJoinPage
        title={invitationQuery.data ? `Join ${invitationQuery.data.team.name}` : 'Join team'}
      >
        <p className="mt-3 text-sm text-muted-foreground">{unusableInvitationMessage ?? redirectMessage}</p>
        {invitationQuery.data ? (
          <div className="mt-5 space-y-5">
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message={`This invitation adds you as a co-owner of ${invitationQuery.data.team.name}. Create your account below to join straight away, or sign in if you already have one.`}
              title="Team co-owner invite"
            />
            <div className="rounded-[1.5rem] border border-border bg-background p-5">
              <div className="flex items-center gap-4">
                {selectedIcon ? (
                  <div className={`flex h-14 w-14 items-center justify-center rounded-[1.1rem] ${selectedIcon.themeClass}`}>
                    <TeamIcon iconKey={invitationQuery.data.team.iconKey} size="md" />
                  </div>
                ) : null}
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Target team</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    You&apos;ll join <span className="font-medium text-foreground">{invitationQuery.data.team.name}</span> as a co-owner inside{' '}
                    <span className="font-medium text-foreground">{invitationQuery.data.league.name}</span>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {inviteCode && invitationQuery.data && !unusableInvitationMessage ? (
          <form
            className="mt-5 space-y-4 rounded-[1.5rem] border border-border bg-background p-5"
            data-testid="team-invite-register-form"
            onSubmit={(event) => {
              event.preventDefault();
              void registerForm.handleSubmit((values) =>
                registerMutation.mutateAsync(values).catch(() => undefined),
              )();
            }}
          >
            <div>
              <h3 className="text-sm font-semibold text-foreground">Create your account</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Your account uses the email this invitation was sent to, so there is nothing to
                confirm — you&apos;ll land on your team.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField error={registerForm.formState.errors.firstName?.message} label="First name">
                <Input
                  data-testid="team-invite-register-first-name"
                  {...registerForm.register('firstName')}
                />
              </FormField>
              <FormField error={registerForm.formState.errors.lastName?.message} label="Last name">
                <Input
                  data-testid="team-invite-register-last-name"
                  {...registerForm.register('lastName')}
                />
              </FormField>
            </div>
            <FormField error={registerForm.formState.errors.username?.message} label="Username">
              <Input
                data-testid="team-invite-register-username"
                {...registerForm.register('username')}
              />
            </FormField>
            <FormField error={registerForm.formState.errors.password?.message} label="Password">
              <Input
                data-testid="team-invite-register-password"
                type="password"
                {...registerForm.register('password')}
              />
            </FormField>
            {registerMutation.isError ? (
              <p className="text-sm text-destructive" data-testid="team-invite-register-error">
                {extractErrorMessage(registerMutation.error, {
                  fallback: 'We could not create your account. Please try again.',
                  codeMessages: {
                    // The one case worth its own words: the invited address already has an
                    // account, so the answer is to sign in rather than register again.
                    SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS:
                      'An account already exists for the email this invitation was sent to. Sign in to accept it.',
                    SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED:
                      'This invitation has already been accepted. Sign in to reach your team.',
                  },
                })}
              </p>
            ) : null}
            <Button
              data-testid="team-invite-register-submit"
              disabled={registerMutation.isPending}
              type="submit"
            >
              {registerMutation.isPending ? 'Creating your account...' : 'Create account and join team'}
            </Button>
          </form>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <LinkButton
            data-testid="team-invite-sign-in"
            state={{ from: buildTeamInvitePath(inviteCode) }}
            to="/"
            variant="secondary"
          >
            I already have an account
          </LinkButton>
          <LinkButton to="/" variant="secondary">
            Back to home
          </LinkButton>
        </div>
      </PublicInviteJoinPage>
    );
  }

  return (
    <PublicInviteJoinPage
      context={(
        <Chip>
          Team invitation
        </Chip>
      )}
      testId="team-owner-invite-page"
      title={invitationQuery.data ? `Join ${invitationQuery.data.team.name}` : 'Accept your team invite'}
    >
      <p className="mt-2 text-sm text-muted-foreground">
        This invitation adds you to an existing team. Team identity is already set, so you&apos;ll join as a co-owner instead of creating a separate team.
      </p>

      <div className="mt-6 rounded-[1.5rem] border border-border bg-background p-5 text-sm text-muted-foreground">
        {invitationQuery.isLoading ? 'Loading invitation...' : null}
        {invitationQuery.isError ? 'We could not load this team invitation.' : null}
        {invitationQuery.data ? (
          <div className="space-y-5">
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message={`Welcome to ${invitationQuery.data.league.name}. You are about to become a co-owner of ${invitationQuery.data.team.name}. Team name and icon are read-only during this acceptance step.`}
              title="Ready to join"
            />
            {selectedIcon ? (
              <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-card p-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-[1.1rem] ${selectedIcon.themeClass}`}>
                  <TeamIcon iconKey={invitationQuery.data.team.iconKey} size="md" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase text-muted-foreground">
                    Team
                  </div>
                  <div className="truncate text-base font-semibold text-foreground">
                    {invitationQuery.data.team.name}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    League homepage: {buildLeaguePath(invitationQuery.data.league.leagueCode)}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {unusableInvitationMessage ? <p className="mt-4">{unusableInvitationMessage}</p> : null}
        {acceptMutation.isPending ? <p>Accepting invitation...</p> : null}
        {acceptMutation.isError ? <p>{getErrorMessage(acceptMutation.error)}</p> : null}
        {acceptMutation.isSuccess ? <p>Invitation accepted. Redirecting you to your team...</p> : null}
      </div>

      {invitationQuery.data && !unusableInvitationMessage ? (
        <div className="mt-5 flex gap-3">
          <Button
            data-testid="team-invite-accept"
            disabled={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate()}
            type="button"
          >
            {acceptMutation.isPending ? 'Joining...' : 'Join as co-owner'}
          </Button>
          <LinkButton
            to={buildLeaguePath(invitationQuery.data.league.leagueCode)}
            variant="secondary"
          >
            Back
          </LinkButton>
        </div>
      ) : null}
    </PublicInviteJoinPage>
  );
}

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useNavigate, useParams } from 'react-router';
import { RegisterWithTeamOwnerInvitationRequestSchema } from '@poolmaster/shared/dto';
import { acceptTeamOwnerInvitation, registerWithTeamOwnerInvitation } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { setAuthSessionUser } from '@/features/auth/auth-session-cache';
import { signUpWithDisplayPreferences } from '@/features/auth/signup-display-preferences';
import { InvitationContextCard } from '@/features/leagues/invitation-context-card';
import { describeUnusableInvitation } from '@/features/leagues/unusable-invitation';
import {
  browserTimeZone,
  Button,
  Chip,
  FormField,
  Heading,
  Input,
  LinkButton,
  PublicInviteJoinPage,
  TimeZoneSelect,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import {
  buildLeaguePath,
  buildLeagueTeamPath,
  buildTeamInvitePath,
  rememberRecentLeagueCode,
} from '@/features/leagues/league-routing';
import { TeamAvatar } from './team-avatar';
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
const RegisterFormSchema = RegisterWithTeamOwnerInvitationRequestSchema.omit({ inviteCode: true, locale: true });
type RegisterFormValues = z.infer<typeof RegisterFormSchema>;

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
    defaultValues: { username: '', password: '', firstName: '', lastName: '', timezone: browserTimeZone() },
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
      const response = await signUpWithDisplayPreferences(values.timezone ?? browserTimeZone(), (preferences) =>
        registerWithTeamOwnerInvitation({
          body: {
            inviteCode,
            username: values.username.trim().toLowerCase(),
            password: values.password,
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            ...preferences,
          },
        }));
      if (!response.data?.user) {
        throwApiError(response.error, 'Registration response is missing data.');
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
        void navigate(buildLeagueTeamPath(leagueCode), { replace: true });
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
        throwApiError(response.error, 'Invitation acceptance response is missing data.');
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
        void navigate(buildLeagueTeamPath(leagueCode));
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
      return 'This co-owner invitation link is missing a code.';
    }

    if (!isAuthenticated) {
      // #217 — no longer a dead end. The registration form below completes the join in one step;
      // this line only sets the heading's tone.
      return 'Create your account to join as a co-owner, or sign in if you already have one.';
    }

    return null;
  }, [inviteCode, isAuthenticated]);

  const unusableInvitationMessage = describeUnusableInvitation(invitationQuery.data?.status);

  if (redirectMessage) {
    return (
      <PublicInviteJoinPage
        title={invitationQuery.data ? `Join ${invitationQuery.data.team.name} as a co-owner` : 'Join as a co-owner'}
      >
        <p className="mt-3 text-sm text-muted-foreground">{unusableInvitationMessage ?? redirectMessage}</p>
        {invitationQuery.data ? (
          <div className="mt-5 space-y-5">
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message={`This invitation adds you as a co-owner of ${invitationQuery.data.team.name}. Create your account below to join straight away, or sign in if you already have one.`}
              title="Co-owner invite"
            />
            <div className="rounded-3xl border border-border bg-background p-5">
              <div className="flex items-center gap-4">
                <TeamAvatar iconKey={invitationQuery.data.team.iconKey} size="lg" />
                <div>
                  <Heading level={3} variant="card" size="sm">What you&apos;re joining</Heading>
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
            className="mt-5 space-y-4 rounded-3xl border border-border bg-background p-5"
            data-testid="team-invite-register-form"
            onSubmit={(event) => {
              event.preventDefault();
              void registerForm.handleSubmit((values) =>
                registerMutation.mutateAsync(values).catch(() => undefined),
              )();
            }}
          >
            <div>
              <Heading level={3} variant="card" size="sm">Create your account</Heading>
              <p className="mt-1 text-sm text-muted-foreground">
                Your account uses the email this invitation was sent to, so there is nothing to
                confirm — you&apos;ll land straight in the league.
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
            <FormField
              error={registerForm.formState.errors.timezone?.message}
              helperText="Dates and times are shown in this zone. You can change it later in your account."
              id="team-invite-register-time-zone"
              label="Time zone"
            >
              <Controller
                control={registerForm.control}
                name="timezone"
                render={({ field }) => (
                  <TimeZoneSelect
                    data-testid="team-invite-register-time-zone"
                    id="team-invite-register-time-zone"
                    name={field.name}
                    onBlur={field.onBlur}
                    onChange={(event) => field.onChange(event.target.value)}
                    ref={field.ref}
                    value={field.value}
                  />
                )}
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
                      'This invitation has already been accepted. Sign in to reach the league.',
                  },
                })}
              </p>
            ) : null}
            <Button
              data-testid="team-invite-register-submit"
              disabled={registerMutation.isPending}
              type="submit"
            >
              {registerMutation.isPending ? 'Creating your account...' : 'Create account and join'}
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
          Co-owner invitation
        </Chip>
      )}
      testId="team-owner-invite-page"
      title={invitationQuery.data ? `Join ${invitationQuery.data.team.name} as a co-owner` : 'Accept your co-owner invite'}
    >
      <p className="mt-2 text-sm text-muted-foreground">
        This invitation makes you a co-owner alongside the people already playing under this name.
      </p>

      <div className="mt-6 rounded-3xl border border-border bg-background p-5 text-sm text-muted-foreground">
        {invitationQuery.isLoading ? 'Loading invitation...' : null}
        {invitationQuery.isError ? 'We could not load this co-owner invitation.' : null}
        {invitationQuery.data ? (
          <div className="space-y-5">
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message={`Welcome to ${invitationQuery.data.league.name}. You are about to become a co-owner of ${invitationQuery.data.team.name}.`}
              title="Ready to join"
            />
            <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
              <TeamAvatar iconKey={invitationQuery.data.team.iconKey} size="lg" />
              <div className="min-w-0">
                <div className="text-xs uppercase text-muted-foreground">
                  You&apos;ll co-own
                </div>
                <div className="truncate text-base font-semibold text-foreground">
                  {invitationQuery.data.team.name}
                </div>
                <div className="text-sm text-muted-foreground">
                  League homepage: {buildLeaguePath(invitationQuery.data.league.leagueCode)}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {unusableInvitationMessage ? <p className="mt-4">{unusableInvitationMessage}</p> : null}
        {acceptMutation.isPending ? <p>Accepting invitation...</p> : null}
        {acceptMutation.isError ? <p>{extractErrorMessage(acceptMutation.error, { fallback: 'We could not accept this co-owner invitation. Please try again.' })}</p> : null}
        {acceptMutation.isSuccess ? <p>Invitation accepted. Taking you to the league...</p> : null}
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

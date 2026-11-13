import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { acceptTeamOwnerInvitation } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { SignUpForm } from '@/features/auth/sign-up-form';
import { InvitationCard } from '@/features/leagues/invitation-card';
import { describeUnusableInvitation, UNKNOWN_INVITATION } from '@/features/leagues/unusable-invitation';
import { InvitationStatusPage } from '@/features/leagues/invitation-status-page';
import {
  Button,
  ErrorState,
  LinkButton,
  LoadingState,
  Notice,
  PublicInviteJoinPage,
  SectionCard,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import {
  buildLeaguePath,
  buildLeagueTeamPath,
  buildTeamInvitePath,
  rememberRecentLeagueCode,
} from '@/features/leagues/league-routing';
import {
  fetchTeamOwnerInvitationPreview,
  getTeamOwnerInvitationPreviewQueryKey,
} from './team-owner-invitation-preview';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { ApiError, extractErrorMessage, hasErrorCode, throwApiError } from '@/lib/errors';

export function JoinTeamOwnerPage() {
  // Memoised: `child()` returns a new logger on every call, and the effects below depend on it,
  // so a logger built during render re-ran them — re-logging the invitation — on every render.
  const logger = useMemo(() => getLogger().child({
    feature: 'join-team-owner-page',
  }), []);
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
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

  /**
   * #217 — register and join in one request. `acceptTeamOwnerInvitation` needs a session, so an
   * invited stranger signs up here against the invitation, which joins them to the league and
   * the team and returns a session.
   */
  function handleRegistered() {
    const leagueCode = invitationQuery.data?.league.leagueCode;
    if (leagueCode) {
      rememberRecentLeagueCode(leagueCode);
      void navigate(buildLeagueTeamPath(leagueCode), { replace: true });
    }
  }

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


  // A link with no code is as unusable as one the server doesn't know.
  const unusableInvitation = !inviteCode || hasErrorCode(invitationQuery.error, 'SQUAD_OWNER_INVITATION_NOT_FOUND')
    ? UNKNOWN_INVITATION
    : describeUnusableInvitation(invitationQuery.data?.status);

  if (unusableInvitation) {
    return <InvitationStatusPage invitation={unusableInvitation} />;
  }

  const invitation = invitationQuery.data;
  const title = invitation ? `Join ${invitation.team.name} in ${invitation.league.name}` : 'Join team';
  const invitationCard = invitation ? (
    <InvitationCard
      inviteCode={invitation.inviteCode}
      leagueName={invitation.league.name}
      team={invitation.team}
    />
  ) : null;
  const invitationState = (
    <>
      {invitationQuery.isLoading ? <LoadingState body="Loading invitation..." size="plain" testId="team-owner-invite-loading" /> : null}
      {invitationQuery.isError ? (
        <ErrorState
          body="We could not load this co-owner invitation."
          onRetry={() => void invitationQuery.refetch()}
          size="plain"
          testId="team-owner-invite-error"
        />
      ) : null}
    </>
  );

  if (!isAuthenticated) {
    // #217: not a dead end. The registration form completes the join in one step.
    return (
      <PublicInviteJoinPage
        secondaryAction={(
          <LinkButton
            data-testid="team-invite-sign-in"
            state={{ from: buildTeamInvitePath(inviteCode) }}
            to="/"
            variant="secondary"
          >
            I already have an account
          </LinkButton>
        )}
        testId="team-owner-invite-signed-out"
        title={title}
      >
        <div className="space-y-5">
          {invitationState}
          {invitationCard}
          {invitation ? (
            <SectionCard
              headingLevel={3}
              help="Your account uses the email this invitation was sent to, so there is nothing to confirm. You'll land straight in the league."
              padded
              testId="team-invite-register"
              title="Create your account"
            >
              <SignUpForm
                errorMessages={{
                  // The one case worth its own words: the invited address already has an
                  // account, so the answer is to sign in rather than register again.
                  SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS:
                    'An account already exists for the email this invitation was sent to. Sign in to accept it.',
                  SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED:
                    'This invitation has already been accepted. Sign in to reach the league.',
                }}
                onRegistered={handleRegistered}
                pendingLabel="Creating your account..."
                submitLabel="Create account and join"
                mode={{ kind: 'teamInvite', inviteCode }}
              />
            </SectionCard>
          ) : null}
        </div>
      </PublicInviteJoinPage>
    );
  }

  return (
    <PublicInviteJoinPage
      primaryAction={invitation ? (
        <Button
          data-testid="team-invite-accept"
          disabled={acceptMutation.isPending}
          onClick={() => acceptMutation.mutate()}
          type="button"
        >
          {acceptMutation.isPending ? 'Joining...' : 'Join as co-owner'}
        </Button>
      ) : null}
      secondaryAction={invitation ? (
        <LinkButton
          data-testid="team-invite-not-now"
          to={buildLeaguePath(invitation.league.leagueCode)}
          variant="secondary"
        >
          Not now
        </LinkButton>
      ) : null}
      testId="team-owner-invite-page"
      title={title}
    >
      <div className="space-y-5">
        {invitationState}
        {invitationCard}
        {acceptMutation.isError ? (
          <Notice data-testid="team-owner-invite-accept-error" tone="danger">
            {extractErrorMessage(acceptMutation.error, { fallback: 'We could not accept this co-owner invitation. Please try again.' })}
          </Notice>
        ) : null}
      </div>
    </PublicInviteJoinPage>
  );
}

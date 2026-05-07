import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { acceptTeamOwnerInvitation } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { InvitationContextCard } from '@/features/leagues/invitation-context-card';
import {
  Button,
  LinkButton,
  PublicInviteJoinPage,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import {
  buildLeaguePath,
  buildLeagueTeamPath,
  buildTeamInvitePath,
  setRecentLeagueCode,
} from '@/features/leagues/league-routing';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';
import {
  fetchTeamOwnerInvitationPreview,
  getTeamOwnerInvitationPreviewQueryKey,
} from './team-owner-invitation-preview';
import { QueryKeys } from '@/lib/query-keys';

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
  const logger = getLogger().child({
    feature: 'join-team-owner-page',
  });
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

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const response = await acceptTeamOwnerInvitation({ body: { inviteCode } });
      if (!response.data?.invitation) {
        throw response.error ?? new Error('Team-owner invitation acceptance response is missing data.');
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
    onSuccess: async () => {
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
        void queryClient.invalidateQueries({ queryKey: QueryKeys.leagues.list });
        void queryClient.invalidateQueries({ queryKey: QueryKeys.leagueTeams.all });
        setRecentLeagueCode(leagueCode);
        navigate(buildLeagueTeamPath(leagueCode));
      }
    },
    onError: (error) => {
      const payload = {
        action: 'teamInvite.accept.failed',
        data: {
          inviteCode,
        },
        err: error,
      };

      if (error instanceof Error) {
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
      return 'Sign in or create an account first, then come back to accept this team invitation.';
    }

    return null;
  }, [inviteCode, isAuthenticated]);

  const selectedIcon = invitationQuery.data
    ? getTeamIconOption(invitationQuery.data.team.iconKey)
    : null;

  if (redirectMessage) {
    return (
      <PublicInviteJoinPage
        title={invitationQuery.data ? `Join ${invitationQuery.data.team.name}` : 'Join team'}
      >
        <p className="mt-3 text-sm text-muted-foreground">{redirectMessage}</p>
        {invitationQuery.data ? (
          <div className="mt-5 space-y-5">
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message={`This invitation adds you as a co-owner of ${invitationQuery.data.team.name}. Sign in with your existing account, or create a new account and then come back here to accept the invite.`}
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
        <div className="mt-5 flex flex-wrap gap-3">
          <LinkButton
            data-testid="team-invite-sign-in"
            state={{ from: buildTeamInvitePath(inviteCode) }}
            to="/"
          >
            Sign in to continue
          </LinkButton>
          <LinkButton
            data-testid="team-invite-create-account"
            state={{ authMode: 'register', from: buildTeamInvitePath(inviteCode) }}
            to="/"
            variant="secondary"
          >
            Create account
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
        <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Team invitation
        </span>
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
                  <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
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
        {acceptMutation.isPending ? <p>Accepting invitation...</p> : null}
        {acceptMutation.isError ? <p>{getErrorMessage(acceptMutation.error)}</p> : null}
        {acceptMutation.isSuccess ? <p>Invitation accepted. Redirecting you to your team...</p> : null}
      </div>

      {invitationQuery.data ? (
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

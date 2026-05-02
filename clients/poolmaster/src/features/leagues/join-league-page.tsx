import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { acceptInvitation, listLeagueSquads, updateLeagueSquad } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { useLogger } from '@/lib/logger';
import {
  Button,
  FormField,
  Input,
  LinkButton,
  PublicInviteJoinPage,
} from '@/features/shared/ui';
import { InvitationContextCard } from './invitation-context-card';
import {
  buildInvitePath,
  buildLeaguePath,
  setRecentLeagueCode,
} from './league-routing';
import {
  fetchInvitationPreview,
  getInvitationPreviewQueryKey,
} from './invitation-preview';
import { buildDefaultTeamName } from '@/features/teams/team-defaults';
import { getTeamIconOption, TEAM_ICON_OPTIONS } from '@/features/teams/team-icon-catalog';
import { TeamIcon } from '@/features/teams/team-icon';

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'We could not accept this invitation. Please try again.';
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

  return 'We could not accept this invitation. Please try again.';
}

export function JoinLeaguePage() {
  const logger = useLogger().child({
    feature: 'join-league-page',
  });
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuth();
  const [teamName, setTeamName] = useState('');
  const [selectedIconKey, setSelectedIconKey] = useState<TeamIconKey>(TeamIconKey.CAPTAIN_SMILE_FIELD);
  const invitationQuery = useQuery({
    queryKey: getInvitationPreviewQueryKey(inviteCode),
    queryFn: () => fetchInvitationPreview(inviteCode),
    enabled: Boolean(inviteCode),
    retry: false,
  });

  useEffect(() => {
    if (!invitationQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'leagueInvite.preview.failed',
        data: {
          inviteCode,
        },
        err: invitationQuery.error,
      },
      'League invitation preview failed to load',
    );
  }, [inviteCode, invitationQuery.error, invitationQuery.isError, logger]);

  useEffect(() => {
    if (!invitationQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'leagueInvite.preview.loaded',
        data: {
          inviteCode,
          leagueId: invitationQuery.data.league.id,
          leagueCode: invitationQuery.data.league.leagueCode,
          isAuthenticated,
        },
      },
      'League invitation preview loaded',
    );
  }, [inviteCode, invitationQuery.data, isAuthenticated, logger]);

  useEffect(() => {
    setTeamName(buildDefaultTeamName(user?.firstName, user?.lastName));
    setSelectedIconKey(TeamIconKey.CAPTAIN_SMILE_FIELD);
  }, [user?.firstName, user?.lastName, inviteCode]);

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const response = await acceptInvitation({ body: { inviteCode } });

      if (!response.data?.membership) {
        throw response.error ?? new Error('Invitation acceptance response is missing data.');
      }

      const acceptedMembership = response.data.membership;
      const leagueId = invitationQuery.data?.league.id;
      const leagueCode = invitationQuery.data?.league.leagueCode;
      const nextTeamName = teamName.trim();

      if (leagueId && user?.id && nextTeamName) {
        const squadsResponse = await listLeagueSquads({ path: { id: leagueId } });
        const myTeam = squadsResponse.data?.squads?.find((team) =>
          team.members?.some((member) => member.userId === user.id && member.status === 'ACTIVE'),
        );

        if (myTeam) {
          const needsTeamUpdate = myTeam.name !== nextTeamName || myTeam.iconKey !== selectedIconKey;

          if (needsTeamUpdate) {
            const updateResponse = await updateLeagueSquad({
              path: { id: leagueId, squadId: myTeam.id },
              body: { name: nextTeamName, iconKey: selectedIconKey },
            });

            if (!updateResponse.data?.squad) {
              throw updateResponse.error ?? new Error('Team update response is missing data.');
            }
          }
        }
      }

      return {
        membership: acceptedMembership,
        leagueCode,
      };
    },
    onMutate: () => {
      logger.debug(
        {
          action: 'leagueInvite.accept.started',
          data: {
            inviteCode,
            hasTeamName: Boolean(teamName.trim()),
            selectedIconKey,
          },
        },
        'Starting league invitation acceptance',
      );
    },
    onSuccess: ({ leagueCode }) => {
      logger.info(
        {
          action: 'leagueInvite.accept.succeeded',
          data: {
            inviteCode,
            leagueCode: leagueCode ?? null,
            selectedIconKey,
          },
        },
        'Accepted league invitation',
      );
      if (leagueCode) {
        void queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] });
        void queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams'] });
        setRecentLeagueCode(leagueCode);
        navigate(buildLeaguePath(leagueCode));
      }
    },
    onError: (error) => {
      const payload = {
        action: 'leagueInvite.accept.failed',
        data: {
          inviteCode,
          selectedIconKey,
        },
        err: error,
      };

      if (error instanceof Error) {
        logger.error(payload, 'League invitation acceptance failed unexpectedly');
      } else {
        logger.warn(payload, 'League invitation acceptance was rejected');
      }
    },
  });

  const redirectMessage = useMemo(() => {
    if (!inviteCode) {
      return 'This invitation link is missing a code.';
    }

    if (!isAuthenticated) {
      return 'Sign in or create an account first, then come back to accept this invitation.';
    }

    return null;
  }, [inviteCode, isAuthenticated]);

  const selectedIcon = getTeamIconOption(selectedIconKey);

  if (redirectMessage) {
    return (
      <PublicInviteJoinPage
        title={invitationQuery.data ? `Join ${invitationQuery.data.league.name}` : 'Join league'}
      >
        <p className="mt-3 text-sm text-muted-foreground">{redirectMessage}</p>
        {invitationQuery.data ? (
          <div className="mt-5">
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message="You've been invited to join this league. Sign in with your existing account, or create a new account and then come back here to accept the invite."
              title="League invite"
            />
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <LinkButton
            data-testid="invite-sign-in"
            state={{ from: buildInvitePath(inviteCode) }}
            to="/"
          >
            Sign in to continue
          </LinkButton>
          <LinkButton
            data-testid="invite-create-account"
            state={{ authMode: 'register', from: buildInvitePath(inviteCode) }}
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
          Invitation
        </span>
      )}
      testId="join-league-page"
      title={invitationQuery.data ? `Join ${invitationQuery.data.league.name}` : 'Accept your league invite'}
    >
      <p className="mt-2 text-sm text-muted-foreground">
        Review the invitation, pick your team name and icon, and join when you&apos;re ready.
      </p>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[1.5rem] border border-border bg-background p-5 text-sm text-muted-foreground">
          {invitationQuery.isLoading ? 'Loading invitation...' : null}
          {invitationQuery.isError ? 'We could not load this invitation.' : null}
          {invitationQuery.data ? (
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message={`You are signed in. Set up your team identity now and choose Join League when you're ready. Current status: ${invitationQuery.data.status}.`}
              title="Ready to join"
            />
          ) : null}
          {acceptMutation.isPending ? <p className="mt-4">Accepting invitation...</p> : null}
          {acceptMutation.isError ? <p className="mt-4">{getErrorMessage(acceptMutation.error)}</p> : null}
          {acceptMutation.isSuccess ? <p className="mt-4">Invitation accepted. Redirecting you to the league...</p> : null}
        </div>

        <div className="rounded-[1.5rem] border border-border bg-background p-5">
          <h3 className="text-base font-semibold text-foreground">Your team setup</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            New members get a team as part of joining the league. You can rename it and choose a built-in icon now.
          </p>

          <div className="mt-5 space-y-4">
            <FormField label="Team name">
              <Input
                data-testid="join-league-team-name"
                maxLength={100}
                onChange={(event) => setTeamName(event.target.value)}
                value={teamName}
              />
            </FormField>

            <div className="space-y-3">
              <div className="text-sm font-medium text-foreground">Team icon</div>
              <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-card px-4 py-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-[1rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
                  <TeamIcon iconKey={selectedIconKey} size="lg" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Selected icon
                  </div>
                  <div className="mt-1 text-base font-medium text-foreground">{selectedIcon.label}</div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                {TEAM_ICON_OPTIONS.map((icon) => {
                  const isSelected = selectedIconKey === icon.key;
                  return (
                    <button
                      className={`rounded-[1.1rem] border px-3 py-4 text-center transition ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                      data-testid={`join-league-team-icon-${icon.key}`}
                      key={icon.key}
                      onClick={() => setSelectedIconKey(icon.key)}
                      type="button"
                    >
                      <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${icon.surfaceClass} ${icon.accentClass}`}>
                        <TeamIcon iconKey={icon.key} size="md" />
                      </div>
                      <div className="mt-3 text-xs font-medium">{icon.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {invitationQuery.data ? (
        <div className="mt-5 flex gap-3">
          <Button
            data-testid="invite-accept"
            disabled={acceptMutation.isPending || !teamName.trim()}
            onClick={() => acceptMutation.mutate()}
            type="button"
          >
            {acceptMutation.isPending ? 'Joining...' : 'Join league'}
          </Button>
          <LinkButton to="/welcome" variant="secondary">
            Back
          </LinkButton>
        </div>
      ) : null}
    </PublicInviteJoinPage>
  );
}

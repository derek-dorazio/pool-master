import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { SquadMembershipStatus, TeamIconKey } from '@poolmaster/shared/domain';
import { acceptInvitation, listLeagueSquads, updateLeagueSquad } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { getLogger } from '@/lib/logger';
import {
  Button,
  Chip,
  FormField,
  IconPalette,
  Input,
  LinkButton,
  PublicInviteJoinPage,
} from '@/features/shared/ui';
import { InvitationContextCard } from './invitation-context-card';
import { describeUnusableInvitation } from './unusable-invitation';
import {
  buildInvitePath,
  buildLeaguePath,
  rememberRecentLeagueCode,
} from './league-routing';
import {
  fetchInvitationPreview,
  getInvitationPreviewQueryKey,
} from './invitation-preview';
import { buildDefaultTeamName } from '@/features/teams/team-defaults';
import { getTeamIconOption, TEAM_ICON_OPTIONS } from '@/features/teams/team-icon-catalog';
import { TeamIcon } from '@/features/teams/team-icon';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import type { ParsedRouteState } from '@/routes/route-state';

export function JoinLeaguePage() {
  const logger = getLogger().child({
    feature: 'join-league-page',
  });
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  // null until the viewer types: the field shows the default built from their name, which is
  // only known once the signed-in user has loaded.
  const [teamNameDraft, setTeamNameDraft] = useState<string | null>(null);
  const [selectedIconKey, setSelectedIconKey] = useState<TeamIconKey>(TeamIconKey.CAPTAIN_SMILE_FIELD);
  const [teamSetupSeedInviteCode, setTeamSetupSeedInviteCode] = useState<string | null>(null);
  const defaultTeamNameSeed = useMemo(
    () => buildDefaultTeamName(user?.firstName, user?.lastName),
    [user?.firstName, user?.lastName],
  );
  const teamName = teamNameDraft ?? defaultTeamNameSeed;
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
    if (teamSetupSeedInviteCode === inviteCode) {
      return;
    }

    setTeamNameDraft(null);
    setSelectedIconKey(TeamIconKey.CAPTAIN_SMILE_FIELD);
    setTeamSetupSeedInviteCode(inviteCode);
  }, [inviteCode, teamSetupSeedInviteCode]);

  const acceptMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await acceptInvitation({ body: { inviteCode } });

      if (!response.data?.membership) {
        throwApiError(response.error, 'Invitation acceptance response is missing data.');
      }

      const acceptedMembership = response.data.membership;
      const leagueId = invitationQuery.data?.league.id;
      const leagueCode = invitationQuery.data?.league.leagueCode;
      const nextTeamName = teamName.trim();
      let teamSetupFailed = false;

      if (leagueId && user?.id && nextTeamName) {
        const squadsResponse = await listLeagueSquads({ path: { id: leagueId } });
        const myTeam = squadsResponse.data?.squads.find((team) =>
          team.members?.some((member) => member.userId === user.id && member.status === SquadMembershipStatus.ACTIVE),
        );

        if (!myTeam) {
          // The name and icon have nowhere to go, which is as much a failed save as a refused rename.
          teamSetupFailed = true;
          logger.warn(
            {
              action: 'leagueInvite.teamSetup.failed',
              data: { inviteCode, leagueId },
              err: squadsResponse.error,
            },
            'Joined the league but could not find the new team to save its chosen name and icon',
          );
        } else {
          const needsTeamUpdate = myTeam.name !== nextTeamName || myTeam.iconKey !== selectedIconKey;

          if (needsTeamUpdate) {
            const updateResponse = await updateLeagueSquad({
              path: { id: leagueId, squadId: myTeam.id },
              body: { name: nextTeamName, iconKey: selectedIconKey },
            });

            // The join has already happened, so a failed rename must not read as a failed
            // join: the viewer goes into the league, and League Home tells them to rename the
            // team from My team.
            if (!updateResponse.data?.squad) {
              teamSetupFailed = true;
              logger.warn(
                {
                  action: 'leagueInvite.teamSetup.failed',
                  data: { inviteCode, leagueId, squadId: myTeam.id },
                  err: updateResponse.error,
                },
                'Joined the league but could not save the chosen team name and icon',
              );
            }
          }
        }
      }

      return {
        membership: acceptedMembership,
        leagueCode,
        teamSetupFailed,
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
    onSuccess: ({ leagueCode, teamSetupFailed }) => {
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
        rememberRecentLeagueCode(leagueCode);
        navigate(
          buildLeaguePath(leagueCode),
          teamSetupFailed ? { state: { teamSetupFailed } satisfies ParsedRouteState } : undefined,
        );
      }
    },
    invalidates: [
      QueryKeys.leagues.list,
      QueryKeys.leagueTeams.all,
    ],
    onError: (error) => {
      const payload = {
        action: 'leagueInvite.accept.failed',
        data: {
          inviteCode,
          selectedIconKey,
        },
        err: error,
      };

      // ApiError wraps every SDK rejection (see throwApiError) so it is
      // always `instanceof Error`; check for it explicitly rather than
      // `error instanceof Error` to keep distinguishing an expected API
      // rejection from a genuine unexpected exception.
      if (!(error instanceof ApiError)) {
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
  const unusableInvitationMessage = describeUnusableInvitation(invitationQuery.data?.status);

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
        <Chip>
          Invitation
        </Chip>
      )}
      testId="join-league-page"
      title={invitationQuery.data ? `Join ${invitationQuery.data.league.name}` : 'Accept your league invite'}
    >
      <p className="mt-2 text-sm text-muted-foreground">
        Review the invitation, choose your name and icon in this league, and join when you&apos;re ready.
      </p>

      {/* One column at every width: the page is a narrow card, so a side-by-side split
          squeezed the icon palette into tiles too small for their labels. */}
      <div className="mt-6 space-y-5">
        <div className="space-y-4 text-sm text-muted-foreground">
          {invitationQuery.isLoading ? <p>Loading invitation...</p> : null}
          {invitationQuery.isError ? <p>We could not load this invitation.</p> : null}
          {invitationQuery.data ? (
            <InvitationContextCard
              inviteCode={invitationQuery.data.inviteCode}
              leagueName={invitationQuery.data.league.name}
              message="Choose your name in this league and select Join League when you're ready."
              title="Ready to join"
            />
          ) : null}
          {unusableInvitationMessage ? <p>{unusableInvitationMessage}</p> : null}
          {acceptMutation.isPending ? <p>Accepting invitation...</p> : null}
          {acceptMutation.isError ? <p>{extractErrorMessage(acceptMutation.error, { fallback: 'We could not accept this invitation. Please try again.' })}</p> : null}
          {acceptMutation.isSuccess ? <p>Invitation accepted. Redirecting you to the league...</p> : null}
        </div>

        <div className="rounded-[1.5rem] border border-border bg-background p-4 sm:p-5">
          <h3 className="text-base font-semibold text-foreground">Your name and icon</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Every member plays in the league under a name and an icon. Choose yours now; you can change both later.
          </p>

          <div className="mt-5 space-y-4">
            <FormField label="Your name in this league">
              <Input
                data-testid="join-league-team-name"
                maxLength={100}
                onChange={(event) => setTeamNameDraft(event.target.value)}
                value={teamName}
              />
            </FormField>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">Your icon</legend>
              <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-card px-4 py-4">
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[1rem] ${selectedIcon.themeClass}`}>
                  <TeamIcon iconKey={selectedIconKey} size="lg" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs uppercase text-muted-foreground">
                    Selected icon
                  </div>
                  <div className="mt-1 text-base font-medium text-foreground">{selectedIcon.label}</div>
                </div>
              </div>
              <IconPalette
                aria-label="Your icon"
                onSelect={setSelectedIconKey}
                optionTestIdPrefix="join-league-team-icon"
                options={TEAM_ICON_OPTIONS}
                renderOptionIcon={(icon) => (
                  <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${icon.themeClass}`}>
                    <TeamIcon iconKey={icon.key} size="md" />
                  </div>
                )}
                testId="join-league-icon-palette"
                value={selectedIconKey}
              />
            </fieldset>
          </div>
        </div>
      </div>

      {invitationQuery.data && !unusableInvitationMessage ? (
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

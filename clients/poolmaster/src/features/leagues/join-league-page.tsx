import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { SquadMembershipStatus, TeamIconKey } from '@poolmaster/shared/domain';
import { acceptInvitation, getLeague, getLeagueSquad, updateLeagueSquad } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { getLogger } from '@/lib/logger';
import {
  Button,
  ErrorState,
  FormField,
  IconPalette,
  Input,
  LinkButton,
  LoadingState,
  Notice,
  PublicInviteJoinPage,
  SectionCard,
  Text,
  Tile,
} from '@/features/shared/ui';
import { InvitationCard } from './invitation-card';
import { describeUnusableInvitation, UNKNOWN_INVITATION } from './unusable-invitation';
import { InvitationStatusPage } from './invitation-status-page';
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
import { TeamAvatar } from '@/features/teams/team-avatar';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { ApiError, extractErrorMessage, hasErrorCode, throwApiError } from '@/lib/errors';
import type { ParsedRouteState } from '@/routes/route-state';

export function JoinLeaguePage() {
  const { inviteCode = '' } = useParams<{ inviteCode: string }>();
  // Keyed by the invite, so another invite starts with a fresh team name and icon.
  return <JoinLeagueByInvite inviteCode={inviteCode} key={inviteCode} />;
}

function JoinLeagueByInvite({ inviteCode }: { inviteCode: string }) {
  const logger = getLogger().child({
    feature: 'join-league-page',
  });
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  // null until the viewer types: the field shows the default built from their name, which is
  // only known once the signed-in user has loaded.
  const [teamNameDraft, setTeamNameDraft] = useState<string | null>(null);
  const [selectedIconKey, setSelectedIconKey] = useState<TeamIconKey>(TeamIconKey.CAPTAIN_SMILE_FIELD);
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
        // The viewer's own squad edge names their new team (#1209), so no team list is read.
        const contextResponse = await getLeague({ path: { id: leagueId } });
        const squadMembership = contextResponse.data?.squadMembership;
        const myTeamResponse = squadMembership?.status === SquadMembershipStatus.ACTIVE
          ? await getLeagueSquad({ path: { id: leagueId, squadId: squadMembership.squadId } })
          : null;
        const myTeam = myTeamResponse?.data?.squad;

        if (!myTeam) {
          // The name and icon have nowhere to go, which is as much a failed save as a refused rename.
          teamSetupFailed = true;
          logger.warn(
            {
              action: 'leagueInvite.teamSetup.failed',
              data: { inviteCode, leagueId },
              err: myTeamResponse?.error ?? contextResponse.error,
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
        void navigate(
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


  const selectedIcon = getTeamIconOption(selectedIconKey);
  // A link with no code is as unusable as one the server doesn't know.
  const unusableInvitation = !inviteCode || hasErrorCode(invitationQuery.error, 'LEAGUE_INVITATION_NOT_FOUND')
    ? UNKNOWN_INVITATION
    : describeUnusableInvitation(invitationQuery.data?.status);

  if (unusableInvitation) {
    return <InvitationStatusPage invitation={unusableInvitation} />;
  }

  const title = invitationQuery.data ? `Join ${invitationQuery.data.league.name}` : 'Join league';
  const invitationCard = invitationQuery.data ? (
    <InvitationCard inviteCode={invitationQuery.data.inviteCode} leagueName={invitationQuery.data.league.name} />
  ) : null;
  const invitationState = (
    <>
      {invitationQuery.isLoading ? <LoadingState body="Loading invitation..." size="plain" testId="join-league-invitation-loading" /> : null}
      {invitationQuery.isError ? (
        <ErrorState
          body="We could not load this invitation."
          onRetry={() => void invitationQuery.refetch()}
          size="plain"
          testId="join-league-invitation-error"
        />
      ) : null}
    </>
  );

  if (!isAuthenticated) {
    return (
      <PublicInviteJoinPage
        primaryAction={(
          <LinkButton
            data-testid="invite-sign-in"
            state={{ from: buildInvitePath(inviteCode) }}
            to="/"
          >
            Sign in
          </LinkButton>
        )}
        secondaryAction={(
          <LinkButton
            data-testid="invite-create-account"
            state={{ authMode: 'register', from: buildInvitePath(inviteCode) }}
            to="/"
            variant="secondary"
          >
            Create account
          </LinkButton>
        )}
        testId="join-league-signed-out"
        title={title}
      >
        {invitationState}
        {invitationCard}
      </PublicInviteJoinPage>
    );
  }

  return (
    <PublicInviteJoinPage
      primaryAction={invitationQuery.data ? (
        <Button
          data-testid="invite-accept"
          disabled={acceptMutation.isPending || !teamName.trim()}
          onClick={() => acceptMutation.mutate()}
          type="button"
        >
          {acceptMutation.isPending ? 'Joining...' : 'Join league'}
        </Button>
      ) : null}
      secondaryAction={invitationQuery.data ? (
        <LinkButton data-testid="invite-not-now" to="/welcome" variant="secondary">
          Not now
        </LinkButton>
      ) : null}
      testId="join-league-page"
      title={title}
    >
      {/* One column at every width: the page is a narrow card, so a side-by-side split
          squeezed the icon palette into tiles too small for their labels. */}
      <div className="space-y-5">
        {invitationState}
        {invitationCard}
        {acceptMutation.isError ? (
          <Notice data-testid="join-league-accept-error" tone="danger">
            {extractErrorMessage(acceptMutation.error, { fallback: 'We could not accept this invitation. Please try again.' })}
          </Notice>
        ) : null}
        <SectionCard
          headingLevel={3}
          help="Every member plays in the league as a team, with a name and an icon. Choose yours now; you can change both later."
          padded
          testId="join-league-your-team"
          title="Your team"
        >
          <div className="space-y-4">
            <FormField label="Your team name">
              <Input
                data-testid="join-league-team-name"
                maxLength={100}
                onChange={(event) => setTeamNameDraft(event.target.value)}
                value={teamName}
              />
            </FormField>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">Your icon</legend>
              <Tile className="flex items-center gap-4" data-testid="join-league-selected-icon" padding="sm">
                <TeamAvatar iconKey={selectedIconKey} size="lg" />
                <div className="min-w-0">
                  <Text as="div" variant="caption">Selected icon</Text>
                  <Text as="div" size="base" variant="strong">{selectedIcon.label}</Text>
                </div>
              </Tile>
              <IconPalette
                aria-label="Your icon"
                onSelect={setSelectedIconKey}
                optionTestIdPrefix="join-league-team-icon"
                options={TEAM_ICON_OPTIONS}
                renderOptionIcon={(icon) => <TeamAvatar iconKey={icon.key} />}
                testId="join-league-icon-palette"
                value={selectedIconKey}
              />
            </fieldset>
          </div>
        </SectionCard>
      </div>
    </PublicInviteJoinPage>
  );
}

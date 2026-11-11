import { useEffect } from 'react';
import { useParams } from 'react-router';
import { buildLeagueTeamEditPath, buildLeagueTeamsPath } from '@/features/leagues/league-routing';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { LeaveLeagueSection } from '@/features/leagues/leave-league-section';
import { SquadHistorySection } from '@/features/championships/squad-history-section';
import {
  Alert,
  EmptyState,
  ErrorState,
  PageHeader,
  LinkButton,
  LoadingState,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { CreateTeamForm } from './create-team-form';
import { TeamAvatar } from './team-avatar';
import { TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import { formatOwnerCount } from './team-directory';
import { TeamOwnersSection } from './team-owners-section';
import { useLeagueSquadQuery } from './use-league-squad-query';
import { useMyTeamOwners } from './use-my-team-owners';

/**
 * Yours: the viewer's own team in this league, and nothing else: its name and icon with Edit team,
 * then its year in the championship and cups (#872) first, since how the team is doing is the
 * page's main job, then its owners, and Leave league as the member's one danger action. The
 * league's all-years view lives on Championships, not here (#1544). Contests and the team's
 * entries in them are on League Home and the Contests page (#1394). A member with no team yet
 * creates one here.
 */
export function MyTeamPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = getLogger().child({ feature: 'my-team-page' });
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const myTeamQuery = useLeagueSquadQuery(leagueId, viewer.mySquadId);
  const myTeam = myTeamQuery.data ?? null;
  const owners = useMyTeamOwners({ leagueCode, leagueId, selectedTeam: myTeam });

  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      { action: 'team.league.failed', data: { leagueCode }, err: leagueQuery.error },
      'My team page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueContext = useLeagueContextGuard(leagueQuery);
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  // Until the team loads, "no team" is unknown, not true: offering Create team here would invite
  // a viewer who already has a team to create a second one.
  if (myTeamQuery.isLoading) {
    return <LoadingState testId="my-team-loading" />;
  }
  if (myTeamQuery.isError) {
    return (
      <ErrorState
        body={extractErrorMessage(myTeamQuery.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}
        onRetry={() => void myTeamQuery.refetch()}
        testId="my-team-error"
        title="This page is unavailable"
      />
    );
  }

  const isInactiveLeague = !league.isActive;

  if (!myTeam) {
    return (
      <section className="space-y-6" data-testid="my-team-page">
        {viewer.isMember && isInactiveLeague ? (
          <Alert data-testid="my-team-league-inactive" tone="warning">
            This league is inactive, so you can&apos;t create a team in it.
          </Alert>
        ) : null}
        {viewer.isMember ? (
          <CreateTeamForm isInactiveLeague={isInactiveLeague} leagueCode={leagueCode} leagueId={leagueId} />
        ) : (
          <EmptyState
            action={<LinkButton to={buildLeagueTeamsPath(leagueCode)} variant="secondary">See every member</LinkButton>}
            body="Only league members have a team here."
            testId="my-team-none"
            title="You aren't playing in this league"
          />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-8" data-testid="my-team-page">
      <PageHeader
        actions={(
          <LinkButton
            data-testid="my-team-edit"
            isDisabled={isInactiveLeague}
            size="sm"
            to={buildLeagueTeamEditPath(leagueCode)}
            variant="secondary"
          >
            Edit team
          </LinkButton>
        )}
        avatar={<TeamAvatar iconKey={myTeam.iconKey} label={`${myTeam.name} icon`} size="md" />}
        meta={`Your team in ${league.name} · ${formatOwnerCount(myTeam)}`}
        testId="my-team-identity"
        title={myTeam.name}
      />

      {isInactiveLeague ? (
        <Alert data-testid="my-team-league-inactive" tone="warning">
          This league is inactive, so this page is read-only.
        </Alert>
      ) : null}

      <SquadHistorySection leagueCode={leagueCode} leagueId={leagueId} squad={myTeam} />

      <TeamOwnersSection
        canManageAnyTeam={viewer.isCommissioner || viewer.isRootAdmin}
        isBusy={owners.isPending}
        isInactiveLeague={isInactiveLeague}
        leagueCode={leagueCode}
        leagueId={leagueId}
        owners={owners}
        team={myTeam}
        testId="my-team-owners"
      />

      {viewer.isMember ? <LeaveLeagueSection league={league} /> : null}
    </section>
  );
}

import { useEffect } from 'react';
import { useParams } from 'react-router';
import { buildLeagueHistoryPath, buildLeagueTeamEditPath, buildLeagueTeamsPath } from '@/features/leagues/league-routing';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { LeaveLeagueSection } from '@/features/leagues/leave-league-section';
import { SquadHistorySection } from '@/features/championships/squad-history-section';
import {
  Alert,
  EmptyState,
  ErrorState,
  IdentityHeading,
  LinkButton,
  LoadingState,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { CreateTeamForm } from './create-team-form';
import { TeamAvatar } from './team-avatar';
import { MyTeamEntriesSection } from './my-team-entries-section';
import { TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import { formatOwnerCount } from './team-directory';
import { TeamOwnersSection } from './team-owners-section';
import { useLeagueSquadQuery } from './use-league-squad-query';
import { useMyTeamOwners } from './use-my-team-owners';

/**
 * My team: the viewer's own team in this league, with Edit team, its owners, its year in the
 * championship and cups (#872), and Leave league as the member's one danger action. A member with
 * no team yet creates one here.
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
            This league is inactive, so you can&apos;t choose your name in it.
          </Alert>
        ) : null}
        {viewer.isMember ? (
          <CreateTeamForm isInactiveLeague={isInactiveLeague} leagueCode={leagueCode} leagueId={leagueId} />
        ) : (
          <EmptyState
            action={<LinkButton to={buildLeagueTeamsPath(leagueCode)} variant="secondary">See every member</LinkButton>}
            body="Only league members play under a name here."
            testId="my-team-none"
            title="You aren't playing in this league"
          />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-8" data-testid="my-team-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <IdentityHeading
          avatar={<TeamAvatar iconKey={myTeam.iconKey} label={`${myTeam.name} icon`} size="md" />}
          meta={formatOwnerCount(myTeam)}
          name={myTeam.name}
          testId="my-team-identity"
        />
        <div className="flex flex-wrap gap-2">
          <LinkButton
            data-testid="my-team-edit"
            isDisabled={isInactiveLeague}
            size="sm"
            to={buildLeagueTeamEditPath(leagueCode)}
            variant="secondary"
          >
            Edit
          </LinkButton>
          <LinkButton
            data-testid="my-team-history-link"
            size="sm"
            to={buildLeagueHistoryPath(leagueCode)}
            variant="secondary"
          >
            All years
          </LinkButton>
        </div>
      </div>

      {isInactiveLeague ? (
        <Alert data-testid="my-team-league-inactive" tone="warning">
          This league is inactive, so this page is read-only.
        </Alert>
      ) : null}

      <MyTeamEntriesSection leagueCode={leagueCode} leagueId={leagueId} teamId={myTeam.id} />

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

      <SquadHistorySection leagueCode={leagueCode} leagueId={leagueId} squad={myTeam} />

      {viewer.isMember ? <LeaveLeagueSection league={league} /> : null}
    </section>
  );
}

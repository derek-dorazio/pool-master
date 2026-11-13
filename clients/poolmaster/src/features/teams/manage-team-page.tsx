import { useState } from 'react';
import { useParams } from 'react-router';
import {
  buildLeagueAdminTeamEditPath,
  buildLeagueAdminTeamsPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Notice,
  PageHeader,
  PendingPage,
  SectionCard,
  SectionRow,
  SectionRows,
} from '@/features/shared/ui';
import { hasErrorCode } from '@/lib/errors';
import { MyTeamLifecycleDialogs, MyTeamLifecycleNotices } from './my-team-lifecycle';
import { TeamAvatar } from './team-avatar';
import type { ActiveTeamDialog } from './my-team-shared';
import { formatOwnerCount } from './team-directory';
import { getTeamIconOption } from './team-icon-catalog';
import { useLeagueSquadQuery } from './use-league-squad-query';
import { useMyTeamLifecycle } from './use-my-team-lifecycle';
import { TeamOwnersSection } from './team-owners-section';
import { useMyTeamOwners } from './use-my-team-owners';

/** Commissioner tools › Teams › one team: its settings, owners and lifecycle. */
export function ManageTeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const teamQuery = useLeagueSquadQuery(leagueId, teamId);
  const team = teamQuery.data ?? null;
  const teamsPath = buildLeagueAdminTeamsPath(leagueCode);

  const [activeDialog, setActiveDialog] = useState<ActiveTeamDialog>(null);
  const owners = useMyTeamOwners({ leagueCode, leagueId, selectedTeam: team });
  const lifecycle = useMyTeamLifecycle({
    afterDeletePath: teamsPath,
    leagueCode,
    leagueId,
    resetOwnerForms: owners.resetOwnerForms,
    selectedTeam: team,
    setActiveDialog,
  });

  if (!league) {
    return null;
  }
  if (teamQuery.isLoading) {
    return <PendingPage spacing={8} testId="manage-team-pending"><LoadingState body="Loading this member..." testId="manage-team-loading" /></PendingPage>;
  }
  if (teamQuery.isError && !hasErrorCode(teamQuery.error, 'SQUAD_NOT_FOUND')) {
    return <PendingPage spacing={8} testId="manage-team-pending"><ErrorState body="We couldn't load this member." onRetry={() => void teamQuery.refetch()} title="Member unavailable" /></PendingPage>;
  }
  if (!team) {
    return (
      <EmptyState
        action={<LinkButton to={teamsPath} variant="secondary">All members</LinkButton>}
        body="They may have left or been removed."
        testId="manage-team-not-found"
        title="This member isn't in this league"
      />
    );
  }

  const isInactiveLeague = !league.isActive;
  const isInactiveTeam = !team.isActive;
  const isBusy = owners.isPending || lifecycle.isPending;
  const iconLabel = getTeamIconOption(team.iconKey).label;

  return (
    <section className="space-y-8" data-testid="manage-team-page">
      <PageHeader
        avatar={<TeamAvatar iconKey={team.iconKey} label={`${team.name} icon`} size="md" />}
        meta={`${formatOwnerCount(team)} · ${isInactiveTeam ? 'Inactive' : 'Active'}`}
        title={team.name}
        testId="manage-team-identity"
      />

      {isInactiveLeague ? (
        <Notice data-testid="manage-team-league-inactive" tone="warning">
          This league is inactive, so this page is read-only.
        </Notice>
      ) : isInactiveTeam ? (
        <Notice data-testid="manage-team-inactive" tone="warning">
          {team.name} is inactive. Inviting a former owner back restores it.
        </Notice>
      ) : null}

      <SectionCard
        trailing={(
          <LinkButton
            data-testid="manage-team-edit"
            isDisabled={isInactiveLeague || isInactiveTeam}
            size="sm"
            to={buildLeagueAdminTeamEditPath(leagueCode, team.id)}
            variant="secondary"
          >
            Edit
          </LinkButton>
        )}
        testId="manage-team-general"
        title="Name and icon"
      >
        <SectionRows>
          <SectionRow layout="setting" name="Name" value={team.name} />
          <SectionRow layout="setting" name="Icon" value={iconLabel} />
        </SectionRows>
      </SectionCard>

      <TeamOwnersSection
        canManageAnyTeam
        isBusy={isBusy}
        isInactiveLeague={isInactiveLeague}
        leagueCode={leagueCode}
        leagueId={leagueId}
        owners={owners}
        team={team}
        testId="manage-team-owners"
      />

      <MyTeamLifecycleNotices lifecycle={lifecycle} />

      <SectionCard testId="manage-team-danger-zone" tone="danger">
        <SectionRows>
          {isInactiveTeam ? (
            <SectionRow
              layout="action"
              aside={(
                <Button
                  data-testid="manage-team-delete"
                  disabled={!viewer.isRootAdmin || isInactiveLeague || isBusy}
                  onClick={() => setActiveDialog('delete')}
                  variant="danger"
                >
                  Delete {team.name}
                </Button>
              )}
              facts={viewer.isRootAdmin
                ? `Removes ${team.name} for good.`
                : `Only a root admin can delete ${team.name}.`}
              name={`Delete ${team.name}`}
            />
          ) : (
            <SectionRow
              layout="action"
              aside={(
                <Button
                  data-testid="manage-team-inactivate"
                  disabled={isInactiveLeague || isBusy}
                  onClick={() => setActiveDialog('inactivate')}
                  variant="danger"
                >
                  Inactivate {team.name}
                </Button>
              )}
              facts="Its owners leave the league. Their accounts and other leagues are untouched."
              name={`Inactivate ${team.name}`}
            />
          )}
        </SectionRows>
      </SectionCard>

      <MyTeamLifecycleDialogs
        activeDialog={activeDialog}
        lifecycle={lifecycle}
        selectedTeam={team}
        setActiveDialog={setActiveDialog}
      />
    </section>
  );
}

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  buildLeagueAdminTeamEditPath,
  buildLeagueAdminTeamsPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  Alert,
  Button,
  DangerZone,
  DangerZoneAction,
  EmptyState,
  ErrorState,
  IdentityHeading,
  LinkButton,
  LoadingState,
  SettingsRow,
  SettingsSection,
} from '@/features/shared/ui';
import { MyTeamLifecycleDialogs, MyTeamLifecycleNotices } from './my-team-lifecycle';
import type { ActiveTeamDialog } from './my-team-shared';
import { formatOwnerCount } from './team-directory';
import { TeamIcon } from './team-icon';
import { getTeamIconOption } from './team-icon-catalog';
import { useLeagueSquadsQuery } from './use-league-squads-query';
import { useMyTeamLifecycle } from './use-my-team-lifecycle';
import { TeamOwnersSection } from './team-owners-section';
import { useMyTeamOwners } from './use-my-team-owners';

/** Commissioner tools › Teams › one team: its settings, owners and lifecycle. */
export function ManageTeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const teamsQuery = useLeagueSquadsQuery(leagueId);
  const team = teamsQuery.data?.find((candidate) => candidate.id === teamId) ?? null;
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
  if (teamsQuery.isLoading) {
    return <LoadingState body="Loading this member..." testId="manage-team-loading" />;
  }
  if (teamsQuery.isError) {
    return <ErrorState body="We couldn't load this league's members." title="Member unavailable" />;
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
      <IdentityHeading
        icon={<TeamIcon iconKey={team.iconKey} size="md" />}
        meta={`${formatOwnerCount(team)} · ${isInactiveTeam ? 'Inactive' : 'Active'}`}
        name={team.name}
        testId="manage-team-identity"
      />

      {isInactiveLeague ? (
        <Alert data-testid="manage-team-league-inactive" tone="warning">
          This league is inactive, so this page is read-only.
        </Alert>
      ) : isInactiveTeam ? (
        <Alert data-testid="manage-team-inactive" tone="warning">
          {team.name} is inactive. Inviting a former owner back restores it.
        </Alert>
      ) : null}

      <SettingsSection
        action={(
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
        <SettingsRow label="Name" value={team.name} />
        <SettingsRow label="Icon" value={iconLabel} />
      </SettingsSection>

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

      <DangerZone testId="manage-team-danger-zone">
        {isInactiveTeam ? (
          <DangerZoneAction
            action={(
              <Button
                data-testid="manage-team-delete"
                disabled={!viewer.isRootAdmin || isInactiveLeague || isBusy}
                onClick={() => setActiveDialog('delete')}
                variant="danger"
              >
                Delete {team.name}
              </Button>
            )}
            description={viewer.isRootAdmin
              ? `Removes ${team.name} for good.`
              : `Only a root admin can delete ${team.name}.`}
            title={`Delete ${team.name}`}
          />
        ) : (
          <DangerZoneAction
            action={(
              <Button
                data-testid="manage-team-inactivate"
                disabled={isInactiveLeague || isBusy}
                onClick={() => setActiveDialog('inactivate')}
                variant="danger"
              >
                Inactivate {team.name}
              </Button>
            )}
            description="Its owners leave the league. Their accounts and other leagues are untouched."
            title={`Inactivate ${team.name}`}
          />
        )}
      </DangerZone>

      <MyTeamLifecycleDialogs
        activeDialog={activeDialog}
        lifecycle={lifecycle}
        selectedTeam={team}
        setActiveDialog={setActiveDialog}
      />
    </section>
  );
}

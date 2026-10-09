import { useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import {
  ActionList,
  ActionModal,
  ActionTile,
  Alert,
  Button,
  DetailWithActionsPage,
  LinkButton,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { formatUserName } from '@/features/account/user-name';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import { getLogger } from '@/lib/logger';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
import { LeaveLeagueSection } from '@/features/leagues/leave-league-section';
import { MyTeamDetailsTile, MyTeamIconModal, MyTeamNameModal } from './my-team-details';
import { MyTeamHeader } from './my-team-header';
import { MyTeamLifecycleActions, MyTeamLifecycleDialogs, MyTeamLifecycleNotices } from './my-team-lifecycle';
import { MyTeamOwnersPanel } from './my-team-owners-panel';
import { type ActiveTeamDialog, TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import { useMyTeamDetails } from './use-my-team-details';
import { useMyTeamLifecycle } from './use-my-team-lifecycle';
import { useMyTeamOwners } from './use-my-team-owners';
import { SquadMembershipStatus } from '@poolmaster/shared/domain';
import { useLeagueSquadsQuery } from './use-league-squads-query';
import { useTeamOwnerInvitationsQuery } from './use-team-owner-invitations-query';

/**
 * Team Home. Owns the league and squad queries, decides which squad is selected and what the
 * viewer may do to it, and composes the details, owners and lifecycle panels.
 *
 * The panels' writes live in page-level hooks so their drafts and results survive a modal
 * closing, and so `isBusy` can disable every control while any team write is in flight.
 */
export function MyTeamPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const logger = getLogger().child({
    feature: 'my-team-page',
  });
  const [activeDialog, setActiveDialog] = useState<ActiveTeamDialog>(null);

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);


  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'team.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'My team page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = league?.id ?? '';

  // Shared with the other team surface: one roster query, one index by user.
  const { membersByUserId: leagueMembersByUserId } = useLeagueMembersQuery(leagueId);

  const teamsQuery = useLeagueSquadsQuery(leagueId);

  const ownerInvitationsQuery = useTeamOwnerInvitationsQuery(leagueId);


  // #202 (A8) — the viewer's own squad is named by their squad membership, delivered once with
  // the league context. This used to scan every squad in the league for a per-row `owner` flag.
  const myTeam = useMemo(() => {
    if (!viewer.mySquadId) {
      return null;
    }

    return teamsQuery.data?.find((team) => team.id === viewer.mySquadId) ?? null;
  }, [teamsQuery.data, viewer.mySquadId]);

  const requestedTeamId = searchParams.get('teamId');
  const requestedTeam = useMemo(
    () => teamsQuery.data?.find((team) => team.id === requestedTeamId) ?? null,
    [requestedTeamId, teamsQuery.data],
  );
  const canManageAnyTeam = viewer.isCommissioner || viewer.isRootAdmin;
  const selectedTeam = useMemo(() => {
    if (requestedTeam && canManageAnyTeam) {
      return requestedTeam;
    }

    return myTeam;
  }, [canManageAnyTeam, myTeam, requestedTeam]);

  const isInactiveLeague = league?.isActive === false;
  const isInactiveTeam = selectedTeam?.isActive === false;
  const canCreateOwnTeam = viewer.isMember;
  const canManageSelectedTeam = Boolean(
    selectedTeam && (selectedTeam.id === viewer.mySquadId || canManageAnyTeam),
  );
  const canDeleteSelectedTeam = Boolean(selectedTeam && isInactiveTeam && viewer.isRootAdmin);
  // #219 — inactivating a team ends its owners' league memberships (#218), so it is league
  // administration, not team management. An owner manages their own team; they do not end it.
  const canInactivateSelectedTeam = Boolean(selectedTeam && canManageAnyTeam);
  const isManagingAnotherTeam = Boolean(
    selectedTeam && myTeam && selectedTeam.id !== myTeam.id && canManageAnyTeam,
  );

  const owners = useMyTeamOwners({ leagueCode, leagueId, selectedTeam });
  const lifecycle = useMyTeamLifecycle({
    leagueId,
    leagueCode,
    selectedTeam,
    setActiveDialog,
    resetOwnerForms: owners.resetOwnerForms,
  });
  const details = useMyTeamDetails({
    leagueId,
    leagueCode,
    teams: teamsQuery.data,
    selectedTeam,
    isInactiveLeague,
    isInactiveTeam,
    canCreateOwnTeam,
    canManageSelectedTeam,
    activeDialog,
    setActiveDialog,
    otherWritesPending: owners.isPending || lifecycle.isPending,
  });

  if (leagueQuery.isLoading) {
    return (
      <Tile padding="lg">Loading your team...</Tile>
    );
  }

  if (leagueQuery.isError || !league) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);
    return (
      <Tile padding="lg">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.body}
        </p>
        <LinkButton className="mt-4" to="/welcome" variant="subtle">
          Back to welcome
        </LinkButton>
      </Tile>
    );
  }

  // Until the squads load, "no team" is unknown, not true: offering the create-team form here
  // would invite a viewer who already has a team to create a second one.
  if (teamsQuery.isLoading) {
    return (
      <Tile padding="lg">Loading your team...</Tile>
    );
  }

  if (teamsQuery.isError) {
    return (
      <Tile padding="lg">
        <Alert tone="danger">
          {extractErrorMessage(teamsQuery.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}
        </Alert>
      </Tile>
    );
  }

  const isBusy = details.isPending || owners.isPending || lifecycle.isPending;
  const activeMembers = (selectedTeam?.members ?? []).filter((member) => member.status === SquadMembershipStatus.ACTIVE);
  const currentIconKey = selectedTeam?.iconKey ?? details.iconDraftKey;
  const teamOwnerInvitations = ownerInvitationsQuery.data?.filter(
    (invitation) => invitation.squadId === selectedTeam?.id,
  ) ?? [];
  const activeOwnerNames = activeMembers.map((member) => formatUserName(member.user.firstName, member.user.lastName));

  return (
    <section className="space-y-6" data-testid="my-team-page">
      <MyTeamHeader
        canCreateOwnTeam={canCreateOwnTeam}
        currentIconKey={currentIconKey}
        isManagingAnotherTeam={isManagingAnotherTeam}
        leagueCode={leagueCode}
        selectedTeam={selectedTeam}
      />

      {isInactiveLeague ? (
        <Alert tone="warning" title="This league is inactive.">
          <p>
            Team information stays visible, but team updates are read-only while the league is
            inactive.
          </p>
        </Alert>
      ) : null}

      <DetailWithActionsPage
        actions={(
          <ActionList>
            {selectedTeam ? (
              <>
                <ActionTile
                  data-testid="my-team-open-name"
                  disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                  label="Change team name"
                  onClick={details.handleOpenTeamNameModal}
                  trailing="Open"
                />
                <ActionTile
                  data-testid="my-team-change-icon"
                  disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                  label="Change team icon"
                  onClick={details.handleOpenIconModal}
                  trailing="Open"
                />
                <ActionTile
                  data-testid="my-team-open-owners"
                  disabled={isBusy || !canManageSelectedTeam}
                  label="Manage owners"
                  onClick={() => setActiveDialog('owners')}
                  trailing="Open"
                />
                <MyTeamLifecycleActions
                  canDeleteSelectedTeam={canDeleteSelectedTeam}
                  canInactivateSelectedTeam={canInactivateSelectedTeam}
                  isBusy={isBusy}
                  isInactiveLeague={isInactiveLeague}
                  isInactiveTeam={isInactiveTeam}
                  lifecycle={lifecycle}
                  setActiveDialog={setActiveDialog}
                />
              </>
            ) : (
              <Alert>
                Create your team before managing owners and lifecycle.
              </Alert>
            )}

            {details.updateTeamMutation.isSuccess ? (
              <Alert tone="success">Your team was updated.</Alert>
            ) : null}
            <MyTeamLifecycleNotices lifecycle={lifecycle} />
          </ActionList>
        )}
        actionsTestId="my-team-actions-tile"
        details={(
          <MyTeamDetailsTile
            activeOwnerNames={activeOwnerNames}
            canCreateOwnTeam={canCreateOwnTeam}
            currentIconKey={currentIconKey}
            details={details}
            isBusy={isBusy}
            isInactiveLeague={isInactiveLeague}
            isInactiveTeam={isInactiveTeam}
            selectedTeam={selectedTeam}
          />
        )}
      />

      {!viewer.isRootAdmin ? <LeaveLeagueSection league={league} /> : null}

      <MyTeamNameModal
        canManageSelectedTeam={canManageSelectedTeam}
        details={details}
        isBusy={isBusy}
        isInactiveLeague={isInactiveLeague}
        isInactiveTeam={isInactiveTeam}
        open={activeDialog === 'name'}
        selectedTeam={selectedTeam}
      />

      <ActionModal
        description="Add, replace, or remove team owners."
        footer={(
          <Button onClick={() => setActiveDialog(null)} variant="secondary">
            Close
          </Button>
        )}
        onCancel={() => setActiveDialog(null)}
        onOpenChange={(open) => setActiveDialog(open ? 'owners' : null)}
        open={activeDialog === 'owners'}
        size="lg"
        testId="my-team-owners-modal"
        title="Manage owners"
      >
        <div className="mt-5">
          <MyTeamOwnersPanel
            activeMembers={activeMembers}
            canManageAnyTeam={canManageAnyTeam}
            canManageSelectedTeam={canManageSelectedTeam}
            isBusy={isBusy}
            isInactiveLeague={isInactiveLeague}
            isInactiveTeam={isInactiveTeam}
            leagueCode={leagueCode}
            leagueId={leagueId}
            leagueMembersByUserId={leagueMembersByUserId}
            notices={<MyTeamLifecycleNotices lifecycle={lifecycle} />}
            owners={owners}
            selectedTeam={selectedTeam}
            teamOwnerInvitations={teamOwnerInvitations}
            viewerUserId={auth.user?.id}
          />
        </div>
      </ActionModal>

      <MyTeamLifecycleDialogs
        activeDialog={activeDialog}
        lifecycle={lifecycle}
        selectedTeam={selectedTeam}
        setActiveDialog={setActiveDialog}
      />

      <MyTeamIconModal
        canCreateOwnTeam={canCreateOwnTeam}
        canManageSelectedTeam={canManageSelectedTeam}
        details={details}
        hasSelectedTeam={Boolean(selectedTeam)}
        isBusy={isBusy}
        isInactiveLeague={isInactiveLeague}
      />
    </section>
  );
}

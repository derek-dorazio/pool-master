import { useQuery } from '@tanstack/react-query';
import { LeagueRole } from '@poolmaster/shared/domain';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { type SquadDto, type TeamOwnerInvitationDto, listLeagueSquads, listSquadOwnerInvitations } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import { buildUserPath } from '@/features/account/user-routing';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import {
  buildLeaguePath,
  buildLeagueTeamHomePath,
} from '@/features/leagues/league-routing';
import { getLogger } from '@/lib/logger';
import {
  Alert,
  Chip,
  DateDisplay,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Tile,
} from '@/features/shared/ui';
import { SquadActions } from './squad-actions';
import { TeamOwnerActionMenu } from './team-owner-action-menu';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
import { throwApiError } from '@/lib/errors';


export function TeamsPage() {
  const logger = getLogger().child({
    feature: 'teams-page',
  });
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);


  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'teams.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'Teams page failed to load league detail',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = league?.id ?? '';

  // Shared with the other team surface: one roster query, one index by user.
  const { membersByUserId: leagueMembersByUserId } = useLeagueMembersQuery(leagueId);

  const teamsQuery = useQuery({
    queryKey: QueryKeys.leagueTeams.byLeague(leagueId),
    queryFn: async (): Promise<SquadDto[]> => {
      const response = await listLeagueSquads({ path: { id: leagueId } });
      if (!response.data?.squads) {
        throwApiError(response.error, 'Team list response is missing data.');
      }

      return response.data.squads;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const ownerInvitationsQuery = useQuery({
    queryKey: QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
    queryFn: async (): Promise<TeamOwnerInvitationDto[]> => {
      const response = await listSquadOwnerInvitations({ path: { id: leagueId } });
      if (!response.data?.invitations) {
        throwApiError(response.error, 'Owner invitation list response is missing data.');
      }

      return response.data.invitations;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });


  const pendingInvitationsByTeam = useMemo(() => {
    const grouped = new Map<string, TeamOwnerInvitationDto[]>();
    for (const invitation of ownerInvitationsQuery.data ?? []) {
      if (invitation.status !== 'PENDING') {
        continue;
      }

      const existing = grouped.get(invitation.squadId) ?? [];
      existing.push(invitation);
      grouped.set(invitation.squadId, existing);
    }
    return grouped;
  }, [ownerInvitationsQuery.data]);


  useEffect(() => {
    if (!league || !teamsQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'teams.page.loaded',
        data: {
          leagueCode: league.leagueCode,
          teamCount: teamsQuery.data.length,
          pendingInvitationCount: ownerInvitationsQuery.data?.filter(
            (invitation) => invitation.status === 'PENDING',
          ).length ?? 0,
        },
      },
      'Teams and owners page loaded',
    );
  }, [league, logger, ownerInvitationsQuery.data, teamsQuery.data]);

  useEffect(() => {
    if (!ownerInvitationsQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'teams.ownerInvitations.failed',
        data: {
          leagueCode,
          leagueId,
        },
        err: ownerInvitationsQuery.error,
      },
      'Teams page failed to load owner invitations',
    );
  }, [leagueCode, leagueId, logger, ownerInvitationsQuery.error, ownerInvitationsQuery.isError]);

  const leagueContext = useLeagueContextGuard(leagueQuery, {
    loadingBody: 'Loading teams and owners...',
  });

  // `!league` is unreachable once the guard reports ready — it is here so the league is
  // narrowed for everything below rather than threaded as `league?.` throughout.
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  // #202 (A8) — the viewer's authority arrives once, with the league, not as a flag repeated on
  // every squad row. Everything below reads it from here.
  const canManageLeague = viewer.isCommissioner || viewer.isRootAdmin;
  // An inactive league is read-only on Team Home; the roster follows suit rather than offering
  // buttons that surface on one screen and not the other.
  const leagueIsActive = league.isActive !== false;



  return (
    <section className="space-y-6" data-testid="teams-page">
      <PageHeader
        breadcrumbs={[
          { href: buildLeaguePath(league.leagueCode), label: 'League Home' },
          { label: 'Teams and Owners' },
        ]}
        description={(
          <>
            Every member of {league.name} owns a team, so this is the league roster. Owners manage
            their own team&apos;s co-owners here; commissioners and root admins manage every team
            and can inactivate one.
          </>
        )}
        eyebrow="League Directory"
        title="Teams and Owners"
      />

      {ownerInvitationsQuery.isError ? (
        <Alert
          tone="warning"
          title="Owner invitations are temporarily unavailable"
        >
          <p>
            Active owners are still shown below, but pending owner invitations could not be loaded
            for this league right now.
          </p>
        </Alert>
      ) : null}

      <Tile>
        <div className="hidden border-b border-border pb-3 text-xs font-medium uppercase text-muted-foreground md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] md:gap-6">
          <span>Team</span>
          <span>Owners</span>
        </div>

        <div className="space-y-4 pt-0 md:pt-4">
          {teamsQuery.isLoading ? (
            <LoadingState
              body="Loading teams..."
              testId="teams-page-teams-loading"
            />
          ) : teamsQuery.isError ? (
            <ErrorState
              body="We couldn't load teams for this league."
              testId="teams-page-teams-error"
              title="Teams unavailable"
            />
          ) : teamsQuery.data?.length ? (
            teamsQuery.data.map((team) => {
              const icon = getTeamIconOption(team.iconKey);
              const activeOwners = (team.members ?? []).filter(
                (member) => member.status === 'ACTIVE',
              );
              const pendingInvitations = pendingInvitationsByTeam.get(team.id) ?? [];

              return (
                <div
                  className="rounded-2xl border border-border bg-background p-5"
                  data-testid={`league-team-${team.id}`}
                  key={team.id}
                >
                  <div className="md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] md:gap-6">
                  <div className="flex min-w-0 items-start gap-4">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] ${icon.themeClass}`}
                    >
                      <TeamIcon iconKey={team.iconKey} size="md" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          className="truncate text-lg font-semibold text-foreground hover:underline"
                          data-testid={`league-team-home-link-${team.id}`}
                          to={buildLeagueTeamHomePath(league.leagueCode, team.id)}
                        >
                          {team.name}
                        </Link>
                        {team.isActive === false ? (
                          <Chip>
                            Inactive
                          </Chip>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Open Team Home for this team&apos;s name, icon, and contest history.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3 md:mt-0">
                    {activeOwners.map((owner) => {
                      const leagueMember = leagueMembersByUserId.get(owner.userId);
                      const canRemoveOwner = canManageLeague || team.id === viewer.mySquadId;

                      return (
                        <div
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
                          data-testid={`league-team-owner-${team.id}-${owner.userId}`}
                          key={owner.id}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <Link
                              className="text-sm font-medium text-foreground hover:underline"
                              data-testid={`league-team-owner-link-${team.id}-${owner.userId}`}
                              to={buildUserPath(owner.userId)}
                            >
                              {formatUserName(owner.user.firstName, owner.user.lastName)}
                            </Link>
                            {leagueMember ? (
                              <span
                                className="text-xs text-muted-foreground"
                                data-testid={`league-team-owner-joined-${team.id}-${owner.userId}`}
                              >
                                Joined{' '}
                                <DateDisplay
                                  className="text-muted-foreground"
                                  timeStyle={null}
                                  value={leagueMember.joinedAt}
                                />
                              </span>
                            ) : null}
                            <Chip>
                              Active owner
                            </Chip>
                            {leagueMember ? (
                              <Chip>
                                {leagueMember.role === LeagueRole.COMMISSIONER ? 'Commissioner' : 'Member'}
                              </Chip>
                            ) : null}
                          </div>
                          <TeamOwnerActionMenu
                            activeOwnerCount={activeOwners.length}
                            canManageLeagueRole={canManageLeague}
                            canRemoveOwner={canRemoveOwner}
                            leagueCode={league.leagueCode}
                            leagueId={leagueId}
                            ownerName={formatUserName(owner.user.firstName, owner.user.lastName)}
                            ownerRole={leagueMember?.role}
                            ownerUserId={owner.userId}
                            surface="teams"
                            teamId={team.id}
                          />
                        </div>
                      );
                    })}

                    {!activeOwners.length ? (
                      <p className="text-sm text-muted-foreground">No owners are listed for this team yet.</p>
                    ) : null}
                  </div>
                  </div>

                  <SquadActions
                    canInactivate={canManageLeague && leagueIsActive}
                    canManageOwners={
                      (canManageLeague || team.id === viewer.mySquadId) && leagueIsActive
                    }
                    leagueId={leagueId}
                    pendingInvitations={pendingInvitations}
                    squadId={team.id}
                    squadIsActive={team.isActive !== false}
                    squadName={team.name}
                  />
                </div>
              );
            })
          ) : (
            <EmptyState
              body="No teams exist for this league yet."
              testId="teams-page-teams-empty"
              title="No teams yet"
            />
          )}
        </div>
      </Tile>
    </section>
  );
}

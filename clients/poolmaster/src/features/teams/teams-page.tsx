import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  getLeagueByCode,
  listLeagueMembers,
  listLeagueSquads,
  listSquadOwnerInvitations,
  type GetLeagueByCodeResponses,
  type ListLeagueMembersResponses,
  type ListLeagueSquadsResponses,
  type ListSquadOwnerInvitationsResponses,
} from '@/lib/api';
import { buildUserPath } from '@/features/account/user-routing';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeaguePath,
  buildLeagueTeamHomePath,
  setRecentLeagueCode,
} from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
import { Alert } from '@/features/shared/ui';
import { TeamOwnerActionMenu } from './team-owner-action-menu';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type LeagueMember = ListLeagueMembersResponses[200]['members'][number];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type OwnerInvitation = ListSquadOwnerInvitationsResponses[200]['invitations'][number];

function formatInvitationStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function getOwnerLabel(firstName?: string, lastName?: string) {
  const display = [firstName, lastName].filter(Boolean).join(' ').trim();
  return display || 'Unknown owner';
}

export function TeamsPage() {
  const logger = useLogger().child({
    feature: 'teams-page',
  });
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();

  const leagueQuery = useQuery({
    queryKey: ['poolmaster', 'league', leagueCode],
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await getLeagueByCode({ path: { leagueCode } });
      if (!response.data?.league) {
        throw response.error ?? new Error('League detail response is missing data.');
      }

      return response.data.league;
    },
    enabled: Boolean(leagueCode),
    retry: false,
  });

  useEffect(() => {
    if (leagueQuery.data?.leagueCode) {
      setRecentLeagueCode(leagueQuery.data.leagueCode);
    }
  }, [leagueQuery.data?.leagueCode]);

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

  const leagueId = leagueQuery.data?.id ?? '';

  const teamsQuery = useQuery({
    queryKey: ['poolmaster', 'league-teams', leagueId],
    queryFn: async (): Promise<TeamSummary[]> => {
      const response = await listLeagueSquads({ path: { id: leagueId } });
      if (!response.data?.squads) {
        throw response.error ?? new Error('Team list response is missing data.');
      }

      return response.data.squads;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const ownerInvitationsQuery = useQuery({
    queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId],
    queryFn: async (): Promise<OwnerInvitation[]> => {
      const response = await listSquadOwnerInvitations({ path: { id: leagueId } });
      if (!response.data?.invitations) {
        throw response.error ?? new Error('Owner invitation list response is missing data.');
      }

      return response.data.invitations;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const leagueMembersQuery = useQuery({
    queryKey: ['poolmaster', 'league-members', leagueId],
    queryFn: async (): Promise<LeagueMember[]> => {
      const response = await listLeagueMembers({ path: { id: leagueId } });
      if (!response.data?.members) {
        throw response.error ?? new Error('League members response is missing data.');
      }

      return response.data.members;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const pendingInvitationsByTeam = useMemo(() => {
    const grouped = new Map<string, OwnerInvitation[]>();
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

  const leagueMembersByUserId = useMemo(
    () => new Map((leagueMembersQuery.data ?? []).map((member) => [member.userId, member])),
    [leagueMembersQuery.data],
  );

  useEffect(() => {
    if (!leagueQuery.data || !teamsQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'teams.page.loaded',
        data: {
          leagueCode: leagueQuery.data.leagueCode,
          teamCount: teamsQuery.data.length,
          pendingInvitationCount: ownerInvitationsQuery.data?.filter(
            (invitation) => invitation.status === 'PENDING',
          ).length ?? 0,
        },
      },
      'Teams and owners page loaded',
    );
  }, [leagueQuery.data, logger, ownerInvitationsQuery.data, teamsQuery.data]);

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

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading teams and owners...</p>
      </section>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        <Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" to="/welcome">
          Back to welcome
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6" data-testid="teams-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to={buildLeaguePath(leagueQuery.data.leagueCode)}
        >
          Back to League Home
        </Link>
        <span className="mt-4 inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          League Directory
        </span>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">Teams and Owners</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Browse every team in {leagueQuery.data.name}. Members use this as a directory, while
          commissioners, root admins, and team co-owners can use the inline owner actions here and
          move to Team Home for deeper lifecycle work.
        </p>
      </div>

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

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="hidden border-b border-border pb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] md:gap-6">
          <span>Team</span>
          <span>Owners</span>
        </div>

        <div className="space-y-4 pt-0 md:pt-4">
          {teamsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading teams...</p>
          ) : teamsQuery.isError ? (
            <p className="text-sm text-muted-foreground">We couldn&apos;t load teams for this league.</p>
          ) : teamsQuery.data?.length ? (
            teamsQuery.data.map((team) => {
              const icon = getTeamIconOption(team.iconKey);
              const activeOwners = (team.members ?? []).filter(
                (member) => member.status === 'ACTIVE',
              );
              const pendingInvitations = pendingInvitationsByTeam.get(team.id) ?? [];

              return (
                <div
                  className="rounded-2xl border border-border bg-background p-5 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] md:gap-6"
                  data-testid={`league-team-${team.id}`}
                  key={team.id}
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] ${icon.surfaceClass} ${icon.accentClass}`}
                    >
                      <TeamIcon iconKey={team.iconKey} size="md" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          className="truncate text-lg font-semibold text-foreground hover:underline"
                          data-testid={`league-team-home-link-${team.id}`}
                          to={buildLeagueTeamHomePath(leagueQuery.data.leagueCode, team.id)}
                        >
                          {team.name}
                        </Link>
                        {team.isActive === false ? (
                          <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                            Inactive
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Open Team Home for owner and lifecycle actions.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3 md:mt-0">
                    {activeOwners.map((owner) => {
                      const leagueMember = leagueMembersByUserId.get(owner.userId);
                      const canManageLeagueRole =
                        team.teamRelationship.commissioner || team.isRootAdmin;
                      const canRemoveOwner =
                        canManageLeagueRole
                        || team.teamRelationship.owner;

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
                              {getOwnerLabel(owner.firstName, owner.lastName)}
                            </Link>
                            <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                              Active owner
                            </span>
                            {leagueMember ? (
                              <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                                {leagueMember.role === 'COMMISSIONER' ? 'Commissioner' : 'Member'}
                              </span>
                            ) : null}
                          </div>
                          <TeamOwnerActionMenu
                            activeOwnerCount={activeOwners.length}
                            canManageLeagueRole={canManageLeagueRole}
                            canRemoveOwner={canRemoveOwner}
                            leagueCode={leagueQuery.data.leagueCode}
                            leagueId={leagueId}
                            ownerName={getOwnerLabel(owner.firstName, owner.lastName)}
                            ownerRole={leagueMember?.role}
                            ownerUserId={owner.userId}
                            surface="teams"
                            teamId={team.id}
                          />
                        </div>
                      );
                    })}

                    {pendingInvitations.map((invitation) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-3"
                        data-testid={`league-team-owner-invitation-${team.id}-${invitation.id}`}
                        key={invitation.id}
                      >
                        <span className="text-sm text-foreground">{invitation.email}</span>
                        <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                          {formatInvitationStatus(invitation.status)} invite
                        </span>
                      </div>
                    ))}

                    {!activeOwners.length && !pendingInvitations.length ? (
                      <p className="text-sm text-muted-foreground">No owners are listed for this team yet.</p>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No teams exist for this league yet.</p>
          )}
        </div>
      </section>
    </section>
  );
}

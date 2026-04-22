import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  getLeagueByCode,
  listLeagueSquads,
  listSquadOwnerInvitations,
  revokeSquadOwnerInvitation,
  type GetLeagueByCodeResponses,
  type ListLeagueSquadsResponses,
  type ListSquadOwnerInvitationsResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { formatUserName } from '@/features/account/user-name';
import { buildLeaguePath, buildLeagueTeamPath, setRecentLeagueCode } from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
import { getTeamIconOption } from './team-icon-catalog';
import { TeamIcon } from './team-icon';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type OwnerInvitation = ListSquadOwnerInvitationsResponses[200]['invitations'][number];

function formatInvitationStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatDate(value: string | undefined) {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString();
}

export function TeamsPage() {
  const logger = useLogger().child({
    feature: 'teams-page',
  });
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const queryClient = useQueryClient();

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
  const isCommissioner = leagueQuery.data?.role === 'COMMISSIONER';

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

  const myTeam = useMemo(() => {
    if (!auth.user?.id) {
      return null;
    }

    return teamsQuery.data?.find((team) =>
      team.members?.some((member) => member.userId === auth.user?.id && member.status === 'ACTIVE'),
    ) ?? null;
  }, [auth.user?.id, teamsQuery.data]);

  const visibleInvitations = useMemo(() => {
    if (!ownerInvitationsQuery.data) {
      return [];
    }

    if (isCommissioner) {
      return ownerInvitationsQuery.data;
    }

    if (!myTeam) {
      return [];
    }

    return ownerInvitationsQuery.data.filter((invitation) => invitation.squadId === myTeam.id);
  }, [isCommissioner, myTeam, ownerInvitationsQuery.data]);

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
          invitationCount: visibleInvitations.length,
          isCommissioner,
          hasMyTeam: Boolean(myTeam),
        },
      },
      'Teams page loaded',
    );
  }, [isCommissioner, leagueQuery.data, logger, myTeam, teamsQuery.data, visibleInvitations.length]);

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

  const revokeInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await revokeSquadOwnerInvitation({
        path: { id: leagueId, invitationId },
      });
      if (!response.data?.invitation) {
        throw response.error ?? new Error('Revoke invitation response is missing data.');
      }

      return response.data.invitation;
    },
    onMutate: (invitationId) => {
      logger.debug(
        {
          action: 'teams.ownerInvitation.revoke.started',
          data: {
            leagueId,
            invitationId,
          },
        },
        'Revoking team-owner invitation',
      );
    },
    onSuccess: async () => {
      logger.info(
        {
          action: 'teams.ownerInvitation.revoke.succeeded',
          data: {
            leagueId,
          },
        },
        'Revoked team-owner invitation',
      );
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId] });
    },
    onError: (error, invitationId) => {
      const payload = {
        action: 'teams.ownerInvitation.revoke.failed',
        data: {
          leagueId,
          invitationId,
        },
        err: error,
      };

      if (error instanceof Error) {
        logger.error(payload, 'Team-owner invitation revoke failed unexpectedly');
      } else {
        logger.warn(payload, 'Team-owner invitation revoke was rejected');
      }
    },
  });

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading teams...</p>
      </section>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">We couldn&apos;t load this league.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Return to the league home page and try again.
        </p>
        <Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" to="/welcome">
          Back to welcome
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6" data-testid="teams-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Teams
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">League teams</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Browse every team in {leagueQuery.data.name}. Members can review the full league directory, and commissioners can jump into any team for adjustments.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeaguePath(leagueQuery.data.leagueCode)}
            >
              Back to league
            </Link>
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeagueTeamPath(leagueQuery.data.leagueCode)}
            >
              My Team
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Pending owner invites</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Owner invites stay visible here so commissioners and team owners can track who has been invited and revoke pending invites when needed.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {ownerInvitationsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading pending owner invites...</p>
          ) : ownerInvitationsQuery.isError ? (
            <p className="text-sm text-muted-foreground">We couldn&apos;t load owner invites for this league.</p>
          ) : visibleInvitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team owner invites are active right now.</p>
          ) : (
            visibleInvitations.map((invitation) => (
              <div
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-background px-4 py-4"
                data-testid={`team-owner-invitation-${invitation.id}`}
                key={invitation.id}
              >
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{invitation.email}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {invitation.team.name} · {formatInvitationStatus(invitation.status)} · Invited {formatDate(invitation.createdAt)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    {formatInvitationStatus(invitation.status)}
                  </span>
                  {invitation.status === 'PENDING' ? (
                    <button
                      className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid={`team-owner-invitation-revoke-${invitation.id}`}
                      disabled={revokeInvitationMutation.isPending}
                      onClick={() => void revokeInvitationMutation.mutateAsync(invitation.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6">
        <h3 className="text-xl font-semibold">Joined teams</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Members can browse every active team in the league. Commissioners can open any team, while members only get direct management links for their own team.
        </p>

        <div className="mt-5 space-y-3">
          {teamsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading teams...</p>
          ) : teamsQuery.isError ? (
            <p className="text-sm text-muted-foreground">We couldn&apos;t load teams for this league.</p>
          ) : teamsQuery.data?.length ? (
            teamsQuery.data.map((team, index) => {
              const icon = getTeamIconOption(team.iconKey);
              const isMyTeam = myTeam?.id === team.id;
              const manageHref = isCommissioner
                ? `${buildLeagueTeamPath(leagueQuery.data.leagueCode)}?teamId=${encodeURIComponent(team.id)}`
                : buildLeagueTeamPath(leagueQuery.data.leagueCode);

              return (
                <div
                  className="rounded-2xl border border-border bg-background px-4 py-4"
                  data-testid={`league-team-${team.id}`}
                  key={team.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-[1rem] ${icon.surfaceClass} ${icon.accentClass}`}>
                        <TeamIcon iconKey={team.iconKey} size="md" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm text-muted-foreground">{index + 1}</span>
                          <h4 className="truncate text-lg font-semibold text-foreground">{team.name}</h4>
                          {isMyTeam ? (
                            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-primary">
                              My Team
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {(team.members ?? [])
                            .filter((member) => member.status === 'ACTIVE')
                            .map((member) => (
                              <div key={member.id}>
                                {formatUserName(member.firstName, member.lastName)} · {member.userId}
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>

                    {isCommissioner || isMyTeam ? (
                      <Link
                        className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
                        to={manageHref}
                      >
                        {isCommissioner && !isMyTeam ? 'Edit team' : 'Manage team'}
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No teams exist for this league yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  createLeagueSquad,
  getLeagueByCode,
  listLeagueSquads,
  updateLeagueSquad,
  type GetLeagueByCodeResponses,
  type ListLeagueSquadsResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { formatUserName } from '@/features/account/user-name';
import { buildLeaguePath, setRecentLeagueCode } from '@/features/leagues/league-routing';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type TeamMember = NonNullable<TeamSummary['members']>[number];

function buildDefaultTeamName(firstName?: string | null, lastName?: string | null) {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim();
  return fullName ? `${fullName}'s Team` : 'My Team';
}

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'We could not complete that team action. Please try again.';
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return 'We could not complete that team action. Please try again.';
}

export function MyTeamPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [teamName, setTeamName] = useState('');

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

  const myTeam = useMemo(() => {
    if (!auth.user?.id) {
      return null;
    }

    return teamsQuery.data?.find((team) =>
      team.members?.some(
        (member) => member.userId === auth.user?.id && member.status === 'ACTIVE',
      ),
    ) ?? null;
  }, [auth.user?.id, teamsQuery.data]);

  useEffect(() => {
    if (myTeam) {
      setTeamName(myTeam.name);
      return;
    }

    setTeamName(buildDefaultTeamName(auth.user?.firstName, auth.user?.lastName));
  }, [auth.user?.firstName, auth.user?.lastName, myTeam]);

  const createTeamMutation = useMutation({
    mutationFn: async ({ nextTeamName }: { nextTeamName: string }) => {
      const response = await createLeagueSquad({
        path: { id: leagueId },
        body: { name: nextTeamName },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team creation response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setTeamName(team.name);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: async ({ teamId, nextTeamName }: { teamId: string; nextTeamName: string }) => {
      const response = await updateLeagueSquad({
        path: { id: leagueId, squadId: teamId },
        body: { name: nextTeamName },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team update response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setTeamName(team.name);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
    },
  });

  async function handleSaveTeam() {
    const nextTeamName = teamName.trim();
    if (!nextTeamName || !leagueId || leagueQuery.data?.isActive === false) {
      return;
    }

    if (myTeam) {
      await updateTeamMutation.mutateAsync({ teamId: myTeam.id, nextTeamName });
      return;
    }

    await createTeamMutation.mutateAsync({ nextTeamName });
  }

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading your team...</p>
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
        <Link
          className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
          to="/welcome"
        >
          Back to welcome
        </Link>
      </section>
    );
  }

  const isInactiveLeague = leagueQuery.data.isActive === false;
  const isBusy = createTeamMutation.isPending || updateTeamMutation.isPending;
  const activeMembers = (myTeam?.members ?? []).filter((member) => member.status === 'ACTIVE');

  return (
    <section className="space-y-6" data-testid="my-team-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Team
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              {myTeam ? myTeam.name : 'Create your team'}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Team identity lives inside the league context. This first slice keeps the workflow
              simple: name your team, review who belongs to it, and keep the product aligned with
              real backend data.
            </p>
          </div>
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
            to={buildLeaguePath(leagueCode)}
          >
            Back to league
          </Link>
        </div>
      </div>

      {isInactiveLeague ? (
        <div className="rounded-[2rem] border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h3 className="text-xl font-semibold">This league is inactive.</h3>
          <p className="mt-2 text-sm text-amber-900/90">
            Team information stays visible, but team updates are read-only while the league is
            inactive.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6">
          <h3 className="text-xl font-semibold">{myTeam ? 'Team details' : 'Create your team'}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {myTeam
              ? 'You can update your team name here. Built-in icon selection and owner roles are planned next.'
              : 'A team is required for league participation. Start with a name that feels right for your group.'}
          </p>

          <div className="mt-5 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Team name</span>
              <input
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="my-team-name"
                disabled={isInactiveLeague || isBusy}
                maxLength={100}
                onChange={(event) => setTeamName(event.target.value)}
                value={teamName}
              />
            </label>

            <button
              className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="my-team-save"
              disabled={!teamName.trim() || isInactiveLeague || isBusy}
              onClick={() => void handleSaveTeam()}
              type="button"
            >
              {isBusy
                ? 'Saving...'
                : myTeam
                  ? 'Save team'
                  : 'Create team'}
            </button>

            {createTeamMutation.isSuccess && !myTeam ? (
              <p className="text-sm text-emerald-700">Your team was created.</p>
            ) : null}
            {updateTeamMutation.isSuccess ? (
              <p className="text-sm text-emerald-700">Your team was updated.</p>
            ) : null}
            {createTeamMutation.isError ? (
              <p className="text-sm text-destructive">{extractErrorMessage(createTeamMutation.error)}</p>
            ) : null}
            {updateTeamMutation.isError ? (
              <p className="text-sm text-destructive">{extractErrorMessage(updateTeamMutation.error)}</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Active team members</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Ownership labels and co-owner management are planned next. For now, this page shows
              the real active members attached to your team.
            </p>

            <div className="mt-5 space-y-3">
              {teamsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading team members...</p>
              ) : teamsQuery.isError ? (
                <p className="text-sm text-muted-foreground">We couldn&apos;t load your team yet.</p>
              ) : !myTeam ? (
                <p className="text-sm text-muted-foreground">
                  Create your team first and the active member list will appear here.
                </p>
              ) : activeMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This team does not have any active members yet.
                </p>
              ) : (
                activeMembers.map((member: TeamMember) => (
                  <div
                    className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-4"
                    data-testid={`my-team-member-${member.userId}`}
                    key={member.id}
                  >
                    <div>
                      <div className="font-medium">
                        {formatUserName(member.firstName, member.lastName)}
                      </div>
                      <div className="text-sm text-muted-foreground">{member.userId}</div>
                    </div>
                    <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                      Active
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">What&apos;s next</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>Built-in team icon selection will land in the next team slice.</li>
              <li>Primary owner and co-owner semantics will become explicit once the backend model is updated.</li>
              <li>League home will keep this page easy to reach as team management grows.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

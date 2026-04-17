import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
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
import { getTeamIconOption, TEAM_ICON_OPTIONS } from './team-icon-catalog';
import { buildDefaultTeamName } from './team-defaults';
import { TeamIcon } from './team-icon';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type TeamMember = NonNullable<TeamSummary['members']>[number];

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
  const [selectedIconKey, setSelectedIconKey] = useState<TeamIconKey>(TeamIconKey.CAPTAIN_SMILE_FIELD);

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
      setSelectedIconKey(myTeam.iconKey);
      return;
    }

    setTeamName(buildDefaultTeamName(auth.user?.firstName, auth.user?.lastName));
    setSelectedIconKey(TeamIconKey.CAPTAIN_SMILE_FIELD);
  }, [auth.user?.firstName, auth.user?.lastName, myTeam]);

  const createTeamMutation = useMutation({
    mutationFn: async ({ nextTeamName, nextIconKey }: { nextTeamName: string; nextIconKey: TeamIconKey }) => {
      const response = await createLeagueSquad({
        path: { id: leagueId },
        body: { name: nextTeamName, iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team creation response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setTeamName(team.name);
      setSelectedIconKey(team.iconKey);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: async ({ teamId, nextTeamName, nextIconKey }: { teamId: string; nextTeamName: string; nextIconKey: TeamIconKey }) => {
      const response = await updateLeagueSquad({
        path: { id: leagueId, squadId: teamId },
        body: { name: nextTeamName, iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team update response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setTeamName(team.name);
      setSelectedIconKey(team.iconKey);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
    },
  });

  async function handleSaveTeam() {
    const nextTeamName = teamName.trim();
    if (!nextTeamName || !leagueId || leagueQuery.data?.isActive === false) {
      return;
    }

    if (myTeam) {
      await updateTeamMutation.mutateAsync({
        teamId: myTeam.id,
        nextTeamName,
        nextIconKey: selectedIconKey,
      });
      return;
    }

    await createTeamMutation.mutateAsync({ nextTeamName, nextIconKey: selectedIconKey });
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
  const selectedIcon = getTeamIconOption(selectedIconKey);

  return (
    <section className="space-y-6" data-testid="my-team-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-16 w-16 items-center justify-center rounded-[1.4rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
              <TeamIcon iconKey={selectedIconKey} size="lg" />
            </div>
            <div>
              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Team
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                {myTeam ? myTeam.name : 'Create your team'}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Team identity lives inside the league context. This slice adds the built-in icon
                catalog so your Team can look distinct before owner controls expand.
              </p>
            </div>
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
              ? 'You can update your team name and choose a built-in icon here.'
              : 'A team is required for league participation. Start with a name and icon that feel right for your group.'}
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

            <div className="space-y-3">
              <div className="text-sm font-medium text-foreground">Team icon</div>
              <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-[1rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
                  <TeamIcon iconKey={selectedIconKey} size="lg" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Selected icon
                  </div>
                  <div className="mt-1 text-base font-medium">{selectedIcon.label}</div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-5">
                {TEAM_ICON_OPTIONS.map((icon) => {
                  const isSelected = selectedIconKey === icon.key;
                  return (
                    <button
                      className={`rounded-[1.1rem] border px-3 py-4 text-center transition ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                      }`}
                      data-testid={`my-team-icon-${icon.key}`}
                      disabled={isInactiveLeague || isBusy}
                      key={icon.key}
                      onClick={() => setSelectedIconKey(icon.key)}
                      type="button"
                    >
                      <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${icon.surfaceClass} ${icon.accentClass}`}>
                        <TeamIcon iconKey={icon.key} size="md" />
                      </div>
                      <div className="mt-3 text-xs font-medium">{icon.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

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
              Teams support one or more owners. For now, this page shows the real active owners
              attached to your team.
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
              <li>Owner add and remove actions will land next on top of this icon-aware team model.</li>
              <li>Join flow will pick up the same icon selection so new members start with a fully formed Team.</li>
              <li>League home will keep this page easy to reach as team management grows.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

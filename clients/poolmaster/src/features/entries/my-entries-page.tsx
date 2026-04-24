import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  enterContest,
  getLeagueByCode,
  listContestEntries,
  listContests,
  listLeagueSquads,
  updateContestEntry,
  type GetLeagueByCodeResponses,
  type ListContestEntriesResponses,
  type ListContestsResponses,
  type ListLeagueSquadsResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { buildContestEntryPath } from '@/features/contests/contest-entry-page';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeagueContestPath,
  buildLeagueTeamPath,
  setRecentLeagueCode,
} from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type ContestSummary = ListContestsResponses[200]['contests'][number];
type ContestEntrySummary = ListContestEntriesResponses[200]['entries'][number];

function isHistoricalContest(status: ContestSummary['status']) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'We could not complete that entry action. Please try again.';
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

  return 'We could not complete that entry action. Please try again.';
}

export function MyEntriesPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const logger = useLogger().child({
    feature: 'my-entries-page',
  });
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryNameDraft, setEntryNameDraft] = useState('');

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
        action: 'myEntries.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'My Entries page failed to load league context',
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

  const contestsQuery = useQuery({
    queryKey: ['poolmaster', 'league-contests', leagueId],
    queryFn: async (): Promise<ContestSummary[]> => {
      const response = await listContests({ path: { id: leagueId } });

      if (!response.data?.contests) {
        throw response.error ?? new Error('Contest list response is missing data.');
      }

      return response.data.contests;
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

  const contestEntriesByContestQuery = useQuery({
    queryKey: ['poolmaster', 'my-entries', myTeam?.id, contestsQuery.data?.map((contest) => contest.id).join(',')],
    queryFn: async (): Promise<Record<string, ListContestEntriesResponses[200]>> => {
      if (!myTeam || !contestsQuery.data) {
        return {};
      }

      const results = await Promise.all(
        contestsQuery.data.map(async (contest) => {
          const response = await listContestEntries({ path: { contestId: contest.id } });

          if (!response.data) {
            throw response.error ?? new Error('Contest entries response is missing data.');
          }

          return [contest.id, response.data] as const;
        }),
      );

      return Object.fromEntries(results);
    },
    enabled: Boolean(myTeam && contestsQuery.data),
    retry: false,
  });

  const activeContestCards = useMemo(() => {
    if (!myTeam || !contestsQuery.data) {
      return [];
    }

    return contestsQuery.data
      .filter((contest) => !isHistoricalContest(contest.status))
      .map((contest) => {
        const entryResponse = contestEntriesByContestQuery.data?.[contest.id];
        const teamEntries = (entryResponse?.entries ?? []).filter((entry) => entry.squadId === myTeam.id);

        return {
          contest,
          isError: contestEntriesByContestQuery.isError,
          teamEntries,
        };
      });
  }, [
    contestEntriesByContestQuery.data,
    contestEntriesByContestQuery.isError,
    contestsQuery.data,
    myTeam,
  ]);

  const createContestEntryMutation = useMutation({
    mutationFn: async (contestId: string) => {
      const response = await enterContest({ path: { contestId } });

      if (!response.data?.entry) {
        throw response.error ?? new Error('Contest entry creation response is missing data.');
      }

      return response.data.entry;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-contests', leagueId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'my-entries', myTeam?.id] }),
      ]);
    },
  });

  const renameContestEntryMutation = useMutation({
    mutationFn: async ({ contestId, entryId, name }: { contestId: string; entryId: string; name: string }) => {
      const response = await updateContestEntry({
        path: { contestId, entryId },
        body: { name },
      });

      if (!response.data?.entry) {
        throw response.error ?? new Error('Contest entry rename response is missing data.');
      }

      return response.data.entry;
    },
    onSuccess: async () => {
      setEditingEntryId(null);
      setEntryNameDraft('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-contests', leagueId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'my-entries', myTeam?.id] }),
      ]);
    },
  });

  function startRenamingEntry(entry: ContestEntrySummary) {
    setEditingEntryId(entry.id);
    setEntryNameDraft(entry.name);
    renameContestEntryMutation.reset();
  }

  function cancelRenamingEntry() {
    setEditingEntryId(null);
    setEntryNameDraft('');
    renameContestEntryMutation.reset();
  }

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading your entries...</p>
      </section>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);

    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
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
  const isContestEntriesBusy = contestEntriesByContestQuery.isLoading;

  return (
    <section className="space-y-6" data-testid="my-entries-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              My Team
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
              My Entries
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              All active contest entry creation and rename actions now live on this page. Historical results stay on Team Home until the dedicated history page lands.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeagueTeamPath(leagueCode)}
            >
              Back to team
            </Link>
          </div>
        </div>
      </div>

      {isInactiveLeague ? (
        <div className="rounded-[2rem] border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h2 className="text-xl font-semibold">This league is inactive.</h2>
          <p className="mt-2 text-sm text-amber-900/90">
            Entry details stay visible, but create and rename actions are read-only while the league is inactive.
          </p>
        </div>
      ) : null}

      {!myTeam ? (
        <section className="rounded-[2rem] border border-border bg-card p-6">
          <h2 className="text-xl font-semibold">Create your team first</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A team is required before you can create or manage contest entries in this league.
          </p>
          <Link
            className="mt-5 inline-flex rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
            data-testid="my-entries-open-team"
            to={buildLeagueTeamPath(leagueCode)}
          >
            Open My Team
          </Link>
        </section>
      ) : (
        <>
          <section className="rounded-[2rem] border border-border bg-card p-6">
            <h2 className="text-xl font-semibold">Active contest entries</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Every contest entry belongs to your team. Create new entries while the contest is open, then rename them here until lock.
            </p>

            <div className="mt-5 space-y-3">
              {contestsQuery.isLoading || isContestEntriesBusy ? (
                <p className="text-sm text-muted-foreground">Loading active contest entries...</p>
              ) : contestsQuery.isError ? (
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t load league contests right now.
                </p>
              ) : activeContestCards.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active contests are available for this league yet.
                </p>
              ) : (
                activeContestCards.map(({ contest, isError, teamEntries }) => (
                  <div
                    className="rounded-[1.5rem] border border-border bg-background p-4"
                    data-testid={`my-entries-contest-${contest.id}`}
                    key={contest.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="font-medium text-foreground">{contest.name}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {contest.selectionType} · {contest.scoringEngine} · {contest.status}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Link
                          className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground"
                          to={buildLeagueContestPath(leagueCode, contest.id)}
                        >
                          Open contest
                        </Link>
                        {contest.status === 'OPEN' ? (
                          <button
                            className="rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid={`my-entries-create-entry-${contest.id}`}
                            disabled={isInactiveLeague || createContestEntryMutation.isPending}
                            onClick={() => void createContestEntryMutation.mutateAsync(contest.id)}
                            type="button"
                          >
                            {createContestEntryMutation.isPending
                              ? 'Creating...'
                              : 'Create entry'}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {isError ? (
                      <p className="mt-3 text-sm text-destructive">
                        We couldn&apos;t load your team&apos;s entries for this contest right now.
                      </p>
                    ) : teamEntries.length ? (
                      <div className="mt-4 space-y-3">
                        {teamEntries.map((entry) => (
                          <div
                            className="rounded-2xl border border-border bg-card px-4 py-4"
                            data-testid={`my-entries-entry-${entry.id}`}
                            key={entry.id}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <div className="font-medium text-foreground">{entry.name}</div>
                                <div className="mt-1 text-sm text-muted-foreground">
                                  {entry.squadName} · Entry {entry.entryNumber}
                                </div>
                              </div>
                              <div className="text-right text-sm text-muted-foreground">
                                <div>{entry.standingsPosition ? `#${entry.standingsPosition}` : 'Rank pending'}</div>
                                <div>{entry.totalScore} pts</div>
                              </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <Link
                                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                                data-testid={`my-entries-open-${entry.id}`}
                                state={{ leagueCode }}
                                to={buildContestEntryPath(contest.id, entry.id)}
                              >
                                {contest.status === 'OPEN' ? 'Open entry' : 'View entry detail'}
                              </Link>
                            </div>
                            {contest.status === 'OPEN' ? (
                              <div className="mt-4 rounded-2xl border border-border bg-background px-4 py-4">
                                {editingEntryId === entry.id ? (
                                  <div className="space-y-3">
                                    <label className="block space-y-2">
                                      <span className="text-sm font-medium text-foreground">Entry name</span>
                                      <input
                                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                                        data-testid={`my-entries-name-input-${entry.id}`}
                                        disabled={isInactiveLeague || renameContestEntryMutation.isPending}
                                        maxLength={100}
                                        onChange={(event) => setEntryNameDraft(event.target.value)}
                                        value={entryNameDraft}
                                      />
                                    </label>
                                    <div className="flex flex-wrap gap-3">
                                      <button
                                        className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                        data-testid={`my-entries-name-save-${entry.id}`}
                                        disabled={isInactiveLeague || !entryNameDraft.trim() || renameContestEntryMutation.isPending}
                                        onClick={() =>
                                          void renameContestEntryMutation.mutateAsync({
                                            contestId: contest.id,
                                            entryId: entry.id,
                                            name: entryNameDraft.trim(),
                                          })
                                        }
                                        type="button"
                                      >
                                        {renameContestEntryMutation.isPending ? 'Saving...' : 'Save name'}
                                      </button>
                                      <button
                                        className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                        data-testid={`my-entries-name-cancel-${entry.id}`}
                                        disabled={renameContestEntryMutation.isPending}
                                        onClick={cancelRenamingEntry}
                                        type="button"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                    {editingEntryId === entry.id && renameContestEntryMutation.isError ? (
                                      <p className="text-sm text-destructive">
                                        {extractErrorMessage(renameContestEntryMutation.error)}
                                      </p>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-sm text-muted-foreground">
                                      The default team-based name is seeded automatically, but you can rename this entry while the contest is open.
                                    </p>
                                    <button
                                      className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                      data-testid={`my-entries-name-edit-${entry.id}`}
                                      disabled={isInactiveLeague || renameContestEntryMutation.isPending}
                                      onClick={() => startRenamingEntry(entry)}
                                      type="button"
                                    >
                                      Rename entry
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Your team does not have an entry in this contest yet.
                      </p>
                    )}
                  </div>
                ))
              )}
              {createContestEntryMutation.isError ? (
                <p className="text-sm text-destructive">
                  {extractErrorMessage(createContestEntryMutation.error)}
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-[2rem] border border-border bg-card p-6">
            <h2 className="text-xl font-semibold">Contest history</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Historical results stay on Team Home for now. The dedicated My Contest History route is still a separate follow-up slice.
            </p>
            <Link
              className="mt-5 inline-flex rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              data-testid="my-entries-open-history-fallback"
              to={buildLeagueTeamPath(leagueCode)}
            >
              Open Team Home history
            </Link>
          </section>
        </>
      )}
    </section>
  );
}

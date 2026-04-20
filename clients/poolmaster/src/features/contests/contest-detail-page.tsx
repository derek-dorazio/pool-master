import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  enterContest,
  getContest,
  getContestEntry,
  getLeague,
  getStandings,
  leaveContest,
  listContestEntries,
  updateContestEntry,
  type GetContestEntryResponses,
  type GetContestResponses,
  type GetStandingsResponses,
  type ListContestEntriesResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { buildContestEntryPath } from '@/features/contests/contest-entry-page';
import {
  buildLeagueContestManagePath,
  buildLeaguePath,
  buildLeagueTeamPath,
} from '@/features/leagues/league-routing';
import { parseRouteState } from '@/routes/route-state';

type ContestDetail = GetContestResponses[200]['contest'];
type LeaderboardEntry = GetStandingsResponses[200]['standings'][number];
type ContestEntrySummary = ListContestEntriesResponses[200]['entries'][number];
type ContestEntryDetail = GetContestEntryResponses[200]['entry'];

function formatDateTimeDisplay(isoString: string | null | undefined) {
  if (!isoString) {
    return 'Unavailable';
  }

  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) {
    return 'Unavailable';
  }

  return new Date(parsed).toLocaleString();
}

function extractErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'We could not update that entry right now.';
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

  return 'We could not update that entry right now.';
}

function getEntryActionLabel(selectionType: ContestDetail['selectionType']) {
  switch (selectionType) {
    case 'SNAKE_DRAFT':
      return 'Join draft';
    case 'PICK_EM':
      return 'Make picks';
    case 'BRACKET_PICK_EM':
      return 'Build bracket';
    case 'BUDGET_PICK':
      return 'Build lineup';
    case 'OPEN_SELECTION':
      return 'Make selections';
    case 'TIERED':
    default:
      return 'Create entry';
  }
}

function getEntryLifecycleCopy(contest: ContestDetail, teamEntryCount: number) {
  const hasEntries = teamEntryCount > 0;

  switch (contest.status) {
    case 'DRAFT':
      return hasEntries
        ? 'This contest is still in draft, so your team entries are on hold until the commissioner opens it.'
        : 'This contest is still in draft, so members cannot enter yet.';
    case 'OPEN':
      return hasEntries
        ? 'Your team can keep creating or editing entries until the contest locks.'
        : 'Entry creation is open right now for your team and closes automatically at lock.';
    case 'DRAFTING':
      return hasEntries
        ? 'Your team entries are live in the draft or selection phase now.'
        : 'This contest has already started its draft or selection flow, so new entries are closed.';
    case 'LOCKED':
      return hasEntries
        ? 'Your team entries are locked and no longer editable.'
        : 'This contest is locked, so new entries are closed.';
    case 'ACTIVE':
      return hasEntries
        ? 'Scoring is active and your team entries are no longer editable.'
        : 'Scoring is active and new entries are closed.';
    case 'COMPLETED':
      return hasEntries
        ? 'This contest is complete and your team entries are now read-only history.'
        : 'This contest is complete and no longer accepts entries.';
    case 'CANCELLED':
      return hasEntries
        ? 'This contest was cancelled, so your team entries are preserved only for reference.'
        : 'This contest was cancelled and no longer accepts entries.';
    default:
      return hasEntries
        ? 'Your team entries follow the live contest lifecycle.'
        : 'Contest entry availability follows the live contest lifecycle.';
  }
}

function formatRelativeToPar(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  if (value === 0) {
    return 'E';
  }

  return value > 0 ? `+${value}` : `${value}`;
}

function formatRoundScore(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

function readLatestPerformanceMetric(
  latestPerformance: Record<string, unknown>,
  key: string,
) {
  return latestPerformance[key];
}

function getParticipantPerformanceView(
  participant: ContestEntryDetail['participants'][number],
) {
  const latestPerformance = participant.latestPerformance ?? {};
  const scoreToPar = formatRelativeToPar(
    readLatestPerformanceMetric(latestPerformance, 'scoreToPar'),
  );
  const finishPosition = readLatestPerformanceMetric(latestPerformance, 'finishPosition');
  const thru = readLatestPerformanceMetric(latestPerformance, 'thru');
  const roundScores = [1, 2, 3, 4].map((round) =>
    formatRoundScore(readLatestPerformanceMetric(latestPerformance, `round${round}`)),
  );

  return {
    scoreToPar,
    finishPosition: typeof finishPosition === 'number' ? finishPosition : null,
    thru:
      typeof thru === 'number' || typeof thru === 'string'
        ? String(thru)
        : null,
    roundScores,
  };
}

function sortDetailedParticipants(
  participants: ContestEntryDetail['participants'],
) {
  return [...participants].sort((left, right) => {
    const leftPerformance = getParticipantPerformanceView(left);
    const rightPerformance = getParticipantPerformanceView(right);

    if (
      leftPerformance.finishPosition !== null
      && rightPerformance.finishPosition !== null
      && leftPerformance.finishPosition !== rightPerformance.finishPosition
    ) {
      return leftPerformance.finishPosition - rightPerformance.finishPosition;
    }

    const leftScoreToPar = left.latestPerformance?.scoreToPar;
    const rightScoreToPar = right.latestPerformance?.scoreToPar;
    if (
      typeof leftScoreToPar === 'number'
      && typeof rightScoreToPar === 'number'
      && leftScoreToPar !== rightScoreToPar
    ) {
      return leftScoreToPar - rightScoreToPar;
    }

    return left.participantName.localeCompare(right.participantName);
  });
}

function ContestLeaderboardEntryDetail({
  contestId,
  entryId,
  enabled,
}: {
  contestId: string;
  entryId: string;
  enabled: boolean;
}) {
  const entryDetailQuery = useQuery({
    queryKey: ['poolmaster', 'contest-entry-detail', contestId, entryId],
    queryFn: async (): Promise<ContestEntryDetail> => {
      const response = await getContestEntry({
        path: { contestId, entryId },
      });

      if (!response.data?.entry) {
        throw response.error ?? new Error('Contest entry detail response is missing data.');
      }

      return response.data.entry;
    },
    enabled,
    retry: false,
  });

  if (!enabled) {
    return null;
  }

  if (entryDetailQuery.isLoading) {
    return (
      <div className="mt-4 rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground">
        Loading lineup detail...
      </div>
    );
  }

  if (entryDetailQuery.isError || !entryDetailQuery.data) {
    return (
      <div className="mt-4 rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground">
        We couldn&apos;t load the lineup detail for this entry.
      </div>
    );
  }

  const participants = sortDetailedParticipants(entryDetailQuery.data.participants);

  if (participants.length === 0) {
    return (
      <div className="mt-4 rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground">
        This entry does not have any picked participants yet.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-[minmax(0,1.5fr)_80px_70px_repeat(4,56px)] gap-2 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <span>Participant</span>
        <span className="text-right">Total</span>
        <span className="text-right">Thru</span>
        <span className="text-right">R1</span>
        <span className="text-right">R2</span>
        <span className="text-right">R3</span>
        <span className="text-right">R4</span>
      </div>
      <div className="divide-y divide-border">
        {participants.map((participant) => {
          const performance = getParticipantPerformanceView(participant);

          return (
            <div
              className="grid grid-cols-[minmax(0,1.5fr)_80px_70px_repeat(4,56px)] gap-2 px-4 py-3 text-sm"
              data-testid={`contest-leaderboard-participant-${entryId}-${participant.participantId}`}
              key={participant.rosterPickId}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{participant.participantName}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {participant.participantStatus
                    ? `Status: ${participant.participantStatus}`
                    : participant.teamAffiliation ?? participant.position ?? 'Contest participant'}
                </div>
              </div>
              <span className="text-right font-medium text-foreground">
                {performance.scoreToPar ?? formatRelativeToPar(participant.contestPoints) ?? '—'}
              </span>
              <span className="text-right text-muted-foreground">
                {performance.thru ?? '—'}
              </span>
              {performance.roundScores.map((roundScore, index) => (
                <span className="text-right text-muted-foreground" key={`${participant.rosterPickId}-round-${index + 1}`}>
                  {roundScore}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ContestDetailPage() {
  const { contestId = '' } = useParams<{ contestId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const hintedLeagueCode = parseRouteState(location.state).leagueCode ?? null;
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryNameDraft, setEntryNameDraft] = useState('');
  const [showLeaderboardDetails, setShowLeaderboardDetails] = useState(false);

  const contestQuery = useQuery({
    queryKey: ['poolmaster', 'contest', contestId],
    queryFn: async (): Promise<ContestDetail> => {
      const response = await getContest({ path: { contestId } });

      if (!response.data?.contest) {
        throw response.error ?? new Error('Contest detail response is missing data.');
      }

      return response.data.contest;
    },
    enabled: Boolean(contestId),
    retry: false,
  });

  const leaderboardQuery = useQuery({
    queryKey: ['poolmaster', 'contest-standings', contestId],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const response = await getStandings({
        path: { contestId },
        query: {
          page: '1',
          pageSize: '50',
          sortBy: 'rank',
        },
      });

      if (!response.data?.standings) {
        throw response.error ?? new Error('Contest standings response is missing data.');
      }

      return response.data.standings;
    },
    enabled: Boolean(contestId),
    retry: false,
  });

  const contestEntriesQuery = useQuery({
    queryKey: ['poolmaster', 'contest-entries', contestId],
    queryFn: async (): Promise<ListContestEntriesResponses[200]> => {
      const response = await listContestEntries({ path: { contestId } });

      if (!response.data) {
        throw response.error ?? new Error('Contest entries response is missing data.');
      }

      return response.data;
    },
    enabled: Boolean(contestId),
    retry: false,
  });

  const leagueCodeQuery = useQuery({
    queryKey: ['poolmaster', 'contest-league-code', contestQuery.data?.leagueId],
    queryFn: async () => {
      const response = await getLeague({ path: { id: contestQuery.data!.leagueId } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League response is missing league data.');
      }

      return response.data.league;
    },
    enabled: Boolean(contestQuery.data?.leagueId),
    retry: false,
  });
  const backToLeaguePath = hintedLeagueCode
    ? buildLeaguePath(hintedLeagueCode)
    : leagueCodeQuery.data?.leagueCode
      ? buildLeaguePath(leagueCodeQuery.data.leagueCode)
      : '/welcome';
  const manageContestPath =
    hintedLeagueCode || leagueCodeQuery.data?.leagueCode
      ? buildLeagueContestManagePath(
          hintedLeagueCode ?? leagueCodeQuery.data!.leagueCode,
          contestId,
        )
      : null;
  const canManageContest =
    (leagueCodeQuery.data?.role === 'COMMISSIONER' || Boolean(auth.user?.isRootAdmin))
    && contestQuery.data?.status === 'DRAFT';
  const canCreateEntry = contestQuery.data?.status === 'OPEN';
  const teamPath =
    hintedLeagueCode || leagueCodeQuery.data?.leagueCode
      ? buildLeagueTeamPath(hintedLeagueCode ?? leagueCodeQuery.data!.leagueCode)
      : null;

  const enterContestMutation = useMutation({
    mutationFn: async () => {
      const response = await enterContest({ path: { contestId } });

      if (!response.data?.entry) {
        throw response.error ?? new Error('Contest entry creation response is missing data.');
      }

      return response.data.entry;
    },
    onSuccess: async (entry) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-standings', contestId] }),
      ]);
      navigate(buildContestEntryPath(contestId, entry.id), {
        state: { leagueCode: hintedLeagueCode ?? leagueCodeQuery.data?.leagueCode ?? null },
      });
    },
  });

  const leaveContestMutation = useMutation({
    mutationFn: async () => {
      const response = await leaveContest({ path: { contestId } });

      if (!response.data?.deleted) {
        throw response.error ?? new Error('Contest leave response is missing data.');
      }

      return response.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-standings', contestId] }),
      ]);
    },
  });

  const renameEntryMutation = useMutation({
    mutationFn: async ({ entryId, name }: { entryId: string; name: string }) => {
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
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-standings', contestId] }),
      ]);
    },
  });

  const displayedEntries = contestEntriesQuery.data?.entries ?? [];
  const currentUserEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const isJoined = contestEntriesQuery.data?.isJoined ?? false;
  const myTeamEntries = displayedEntries.filter((entry) => currentUserEntryIds.includes(entry.id));
  const hasTeamEntries = myTeamEntries.length > 0;
  const canLeaveEntries = contestQuery.data?.status === 'OPEN' && hasTeamEntries;
  const primaryTeamEntry = myTeamEntries[0] ?? null;

  function startRenamingEntry(entry: ContestEntrySummary) {
    setEditingEntryId(entry.id);
    setEntryNameDraft(entry.name);
    renameEntryMutation.reset();
  }

  function cancelRenamingEntry() {
    setEditingEntryId(null);
    setEntryNameDraft('');
    renameEntryMutation.reset();
  }

  if (contestQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading contest detail...</p>
      </section>
    );
  }

  if (contestQuery.isError || !contestQuery.data) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">We couldn&apos;t load this contest.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route is already reading from the generated SDK and current service contract.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {contestQuery.data.status}
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight" data-testid="contest-detail-heading">
                {contestQuery.data.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-detail-summary">
                {contestQuery.data.selectionType} · {contestQuery.data.scoringEngine}
                {contestQuery.data.sport ? ` · ${contestQuery.data.sport}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {canManageContest && manageContestPath ? (
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
                data-testid="contest-manage-link"
                to={manageContestPath}
              >
                Manage contest
              </Link>
            ) : null}
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
              data-testid="contest-back-to-league"
              to={backToLeaguePath}
            >
              Back to league
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6" id="contest-rules">
          <h3 className="text-xl font-semibold">Contest rules and snapshot</h3>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-sm text-muted-foreground">
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Contest type</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.contestType}</dd>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Selection type</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.selectionType}</dd>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Scoring engine</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.scoringEngine}</dd>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Entries</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.entryCount ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Your team entries</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {getEntryLifecycleCopy(contestQuery.data, myTeamEntries.length)}
              </p>
            </div>
            {primaryTeamEntry ? (
              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {primaryTeamEntry.status}
              </span>
            ) : null}
          </div>
          <div className="mt-5 space-y-4" data-testid="contest-my-entry">
            {contestEntriesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading your team entries...</p>
            ) : contestEntriesQuery.isError ? (
              <p className="text-sm text-destructive">
                We couldn&apos;t load your team entries right now.
              </p>
            ) : hasTeamEntries ? (
              <>
                <div className="space-y-3">
                  {myTeamEntries.map((entry) => (
                    <div
                      className="rounded-2xl border border-border bg-background px-4 py-4"
                      data-testid={`contest-my-team-entry-${entry.id}`}
                      key={entry.id}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-medium">{entry.name}</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {entry.squadName} · Entry {entry.entryNumber}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-foreground">
                            {entry.totalScore} pts
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {entry.standingsPosition ? `Rank #${entry.standingsPosition}` : 'Rank pending'}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Link
                          className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                          data-testid={`contest-entry-open-${entry.id}`}
                          state={{ leagueCode: hintedLeagueCode ?? leagueCodeQuery.data?.leagueCode ?? null }}
                          to={buildContestEntryPath(contestId, entry.id)}
                        >
                          {contestQuery.data.status === 'OPEN' ? 'Open entry' : 'View entry detail'}
                        </Link>
                      </div>
                      {contestQuery.data.status === 'OPEN' ? (
                        <div className="mt-4 rounded-2xl border border-border bg-card px-4 py-4">
                          {editingEntryId === entry.id ? (
                            <div className="space-y-3">
                              <label className="block space-y-2">
                                <span className="text-sm font-medium text-foreground">Entry name</span>
                                <input
                                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                                  data-testid={`contest-entry-name-input-${entry.id}`}
                                  disabled={renameEntryMutation.isPending}
                                  maxLength={100}
                                  onChange={(event) => setEntryNameDraft(event.target.value)}
                                  value={entryNameDraft}
                                />
                              </label>
                              <div className="flex flex-wrap gap-3">
                                <button
                                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                  data-testid={`contest-entry-name-save-${entry.id}`}
                                  disabled={!entryNameDraft.trim() || renameEntryMutation.isPending}
                                  onClick={() =>
                                    void renameEntryMutation.mutateAsync({
                                      entryId: entry.id,
                                      name: entryNameDraft.trim(),
                                    })
                                  }
                                  type="button"
                                >
                                  {renameEntryMutation.isPending ? 'Saving...' : 'Save name'}
                                </button>
                                <button
                                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                  data-testid={`contest-entry-name-cancel-${entry.id}`}
                                  disabled={renameEntryMutation.isPending}
                                  onClick={cancelRenamingEntry}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </div>
                              {editingEntryId === entry.id && renameEntryMutation.isError ? (
                                <p className="text-sm text-destructive">
                                  {extractErrorMessage(renameEntryMutation.error)}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-sm text-muted-foreground">
                                The default team-based name is seeded automatically, but you can rename this entry while the contest is still open.
                              </div>
                              <button
                                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                data-testid={`contest-entry-name-edit-${entry.id}`}
                                disabled={renameEntryMutation.isPending}
                                onClick={() => startRenamingEntry(entry)}
                                type="button"
                              >
                                Rename entry
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                      <dl className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt>Editability</dt>
                          <dd className="mt-1 font-medium text-foreground">
                            {contestQuery.data.status === 'OPEN' ? 'Editable until lock' : 'Locked or historical'}
                          </dd>
                        </div>
                        <div>
                          <dt>Elimination</dt>
                          <dd className="mt-1 font-medium text-foreground">
                            {entry.isEliminated ? 'Eliminated' : 'Still live'}
                          </dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd className="mt-1 font-medium text-foreground">
                            {formatDateTimeDisplay(entry.createdAt)}
                          </dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd className="mt-1 font-medium text-foreground">
                            {formatDateTimeDisplay(entry.updatedAt)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
                {canCreateEntry ? (
                  <button
                    className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="contest-enter-entry"
                    disabled={enterContestMutation.isPending}
                    onClick={() => void enterContestMutation.mutateAsync()}
                    type="button"
                  >
                    {enterContestMutation.isPending
                      ? 'Creating entry...'
                      : 'Create entry'}
                  </button>
                ) : null}
                {canLeaveEntries && primaryTeamEntry ? (
                  <button
                    className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="contest-leave-entry"
                    disabled={leaveContestMutation.isPending}
                    onClick={() => void leaveContestMutation.mutateAsync()}
                    type="button"
                  >
                    {leaveContestMutation.isPending
                      ? 'Leaving...'
                      : `Leave latest entry for ${primaryTeamEntry.squadName}`}
                  </button>
                ) : null}
                {enterContestMutation.isError ? (
                  <p className="text-sm text-destructive">
                    We couldn&apos;t create another entry for your team right now.
                  </p>
                ) : null}
                {leaveContestMutation.isError ? (
                  <p className="text-sm text-destructive">
                    We couldn&apos;t remove your team entry right now.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-4">
                  <p className="font-medium text-foreground">Your team doesn&apos;t have an entry in this contest yet.</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {canCreateEntry
                      ? 'Create the first entry for your team from this contest page or the team home page.'
                      : getEntryLifecycleCopy(contestQuery.data, 0)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {canCreateEntry ? (
                    <button
                      className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="contest-enter-entry"
                      disabled={enterContestMutation.isPending}
                      onClick={() => void enterContestMutation.mutateAsync()}
                      type="button"
                    >
                      {enterContestMutation.isPending
                        ? 'Creating entry...'
                        : getEntryActionLabel(contestQuery.data.selectionType)}
                    </button>
                  ) : null}
                  {teamPath ? (
                    <Link
                      className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
                      data-testid="contest-manage-team-link"
                      to={teamPath}
                    >
                      View team
                    </Link>
                  ) : null}
                </div>
                {enterContestMutation.isError ? (
                  <p className="text-sm text-destructive">
                    We couldn&apos;t create your team&apos;s contest entry right now.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6">
          <h3 className="text-xl font-semibold">All entries</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Contest entries are always shown with both the entry name and the team name.
          </p>
          <div className="mt-5 space-y-3" data-testid="contest-entry-list">
            {contestEntriesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading contest entries...</p>
            ) : contestEntriesQuery.isError ? (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load the current contest entries.
              </p>
            ) : displayedEntries.length ? (
              displayedEntries.map((entry: ContestEntrySummary) => {
                const isCurrentUserEntry = currentUserEntryIds.includes(entry.id);

                return (
                  <div
                    className="rounded-2xl border border-border bg-background px-4 py-4"
                    data-testid={`contest-entry-${entry.id}`}
                    key={entry.id}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entry.name}</span>
                          {isCurrentUserEntry ? (
                            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                              Your team
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {entry.squadName} · Entry {entry.entryNumber}
                        </div>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        <div>{entry.standingsPosition ? `#${entry.standingsPosition}` : 'Rank pending'}</div>
                        <div>{entry.totalScore} pts</div>
                      </div>
                    </div>
                    {isCurrentUserEntry ? (
                      <div className="mt-4">
                        <Link
                          className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                          data-testid={`contest-entry-open-${entry.id}`}
                          state={{ leagueCode: hintedLeagueCode ?? leagueCodeQuery.data?.leagueCode ?? null }}
                          to={buildContestEntryPath(contestId, entry.id)}
                        >
                          {contestQuery.data.status === 'OPEN' ? 'Open entry' : 'View entry detail'}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                {isJoined
                  ? 'Your contest entry exists, but the contest entry list has not populated yet.'
                  : 'No contest entries exist yet.'}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Leaderboard</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This is the primary live and final contest view. Hide details to focus on entry standings only.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                data-testid="contest-view-rules"
                href="#contest-rules"
              >
                View rules
              </a>
              <button
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                data-testid="contest-toggle-leaderboard-details"
                onClick={() => setShowLeaderboardDetails((current) => !current)}
                type="button"
              >
                {showLeaderboardDetails ? 'Hide details' : 'Show details'}
              </button>
            </div>
          </div>
          <div className="mt-5 space-y-3" data-testid="contest-leaderboard">
            {leaderboardQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading leaderboard...</p>
            ) : leaderboardQuery.isError ? (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load the leaderboard for this contest.
              </p>
            ) : leaderboardQuery.data?.length ? (
              leaderboardQuery.data.map((entry) => (
                <div
                  className="rounded-2xl border border-border bg-background px-4 py-4"
                  data-testid={`contest-leaderboard-entry-${entry.entryId}`}
                  key={entry.entryId}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">{entry.entryName}</div>
                      <div className="text-sm text-muted-foreground">
                        {entry.ownerDisplayName}
                        {entry.isEliminated ? ' · Eliminated' : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-foreground">#{entry.rank}</div>
                      <div className="text-sm text-muted-foreground">{entry.totalScore}</div>
                    </div>
                  </div>
                  <ContestLeaderboardEntryDetail
                    contestId={contestId}
                    enabled={showLeaderboardDetails}
                    entryId={entry.entryId}
                  />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No leaderboard entries yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6">
        <h3 className="text-xl font-semibold">Lifecycle</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Contest status should follow the real golf event and scoring feed automatically. Commissioners
          can manage draft setup before the event begins, but PoolMaster should handle lock,
          in-progress, and completed transitions from event timing and feed updates rather than
          manual status controls.
        </p>
      </div>
    </section>
  );
}

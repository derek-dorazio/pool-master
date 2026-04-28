import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  enterContest,
  getContest,
  listContestEntries,
  listLeagueSquads,
  updateContestEntry,
  type GetContestResponses,
  type ListContestEntriesResponses,
  type ListLeagueSquadsResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { extractErrorMessage } from '@/lib/errors';
import {
  buildContestEntryPath,
  buildLeagueContestEntryPath,
  buildLeagueContestManagePath,
  buildLeaguePath,
} from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';

type ContestDetail = GetContestResponses[200]['contest'];
type ContestEntryDetail = ListContestEntriesResponses[200]['entries'][number];
type ContestEntryParticipant = NonNullable<ContestEntryDetail['participants']>[number];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];

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

function getParticipantPerformanceView(participant: ContestEntryParticipant) {
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

function sortDetailedParticipants(participants: ContestEntryParticipant[]) {
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

    return left.participantName.localeCompare(right.participantName);
  });
}

function ParticipantsTable({
  entryId,
  participants,
}: {
  entryId: string;
  participants: ContestEntryParticipant[];
}) {
  const sorted = sortDetailedParticipants(participants);

  if (sorted.length === 0) {
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
        {sorted.map((participant) => {
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
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logger = useLogger().child({
    feature: 'contest-board',
  });
  const { contestId = '', leagueCode: routeLeagueCode } = useParams<{
    contestId: string;
    leagueCode?: string;
  }>();
  const location = useLocation();
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [myOnly, setMyOnly] = useState(false);
  const [renameEntryId, setRenameEntryId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

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

  const leagueId = contestQuery.data?.leagueId ?? '';

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

  const myTeamId = useMemo(() => {
    const userId = auth.user?.id;
    if (!userId) {
      return null;
    }
    return (
      teamsQuery.data?.find((team) =>
        team.members?.some(
          (member) => member.userId === userId && member.status === 'ACTIVE',
        ),
      )?.id ?? null
    );
  }, [auth.user?.id, teamsQuery.data]);

  const enterContestMutation = useMutation({
    mutationFn: async () => {
      const response = await enterContest({ path: { contestId } });
      if (!response.data?.entry) {
        throw response.error ?? new Error('Contest entry creation response is missing data.');
      }
      return response.data.entry;
    },
    onSuccess: async (entry) => {
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] });
      navigate(
        hintedLeagueCode
          ? buildLeagueContestEntryPath(hintedLeagueCode, contestId, entry.id)
          : buildContestEntryPath(contestId, entry.id),
        {
        state: { leagueCode: hintedLeagueCode },
        },
      );
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
      setRenameEntryId(null);
      setRenameDraft('');
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] });
    },
  });

  useEffect(() => {
    if (!contestQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'contestBoard.contest.failed',
        data: {
          contestId,
          leagueCode: hintedLeagueCode ?? null,
        },
        err: contestQuery.error,
      },
      'Contest Board failed to load contest data',
    );
  }, [contestId, contestQuery.error, contestQuery.isError, hintedLeagueCode, logger]);

  useEffect(() => {
    if (!contestQuery.data || !contestEntriesQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestBoard.page.loaded',
        data: {
          contestId,
          leagueCode: hintedLeagueCode ?? null,
          status: contestQuery.data.status,
          entryCount: contestEntriesQuery.data.entries.length,
          isJoined: contestEntriesQuery.data.isJoined,
          picksRevealed: contestEntriesQuery.data.picksRevealed,
        },
      },
      'Contest Board page loaded',
    );
  }, [
    contestEntriesQuery.data,
    contestId,
    contestQuery.data,
    hintedLeagueCode,
    logger,
  ]);

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
          Try refreshing or return to League Home.
        </p>
      </section>
    );
  }

  const contest = contestQuery.data;
  const entries = contestEntriesQuery.data?.entries ?? [];
  const picksRevealed = contestEntriesQuery.data?.picksRevealed ?? false;
  const myEntries = myTeamId
    ? entries.filter((entry) => entry.squadId === myTeamId)
    : [];
  const totalCount = entries.length;
  const myCount = myEntries.length;
  const visibleEntries = myOnly ? myEntries : entries;
  const isOpen = contest.status === 'OPEN';
  const canCreateEntry = isOpen && Boolean(myTeamId);

  const backToLeaguePath = hintedLeagueCode
    ? buildLeaguePath(hintedLeagueCode)
    : '/welcome';
  const manageContestPath =
    hintedLeagueCode && contest.status === 'DRAFT'
      ? buildLeagueContestManagePath(hintedLeagueCode, contestId)
      : null;

  function startRenameEntry(entry: ContestEntryDetail) {
    setRenameEntryId(entry.id);
    setRenameDraft(entry.name);
    renameEntryMutation.reset();
  }

  function cancelRenameEntry() {
    setRenameEntryId(null);
    setRenameDraft('');
    renameEntryMutation.reset();
  }

  return (
    <section className="space-y-6" data-testid="contest-board">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {contest.status}
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight" data-testid="contest-detail-heading">
                {contest.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-detail-summary">
                {contest.selectionType} · {contest.scoringEngine}
                {contest.sport ? ` · ${contest.sport}` : ''}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <span
                  className="rounded-full border border-border px-3 py-1 text-muted-foreground"
                  data-testid="contest-board-my-count"
                >
                  My Entries: <span className="font-semibold text-foreground">{myCount}</span>
                </span>
                <span
                  className="rounded-full border border-border px-3 py-1 text-muted-foreground"
                  data-testid="contest-board-total-count"
                >
                  Total Entries: <span className="font-semibold text-foreground">{totalCount}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {manageContestPath ? (
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

      <div className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">
              {picksRevealed ? 'Leaderboard' : 'Entries'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {picksRevealed
                ? 'Picks are visible. Expand a row to see each entry’s lineup and live scoring.'
                : 'Picks are hidden until the contest moves past OPEN. Your own entry expands to its picks; other teams show only how many picks they’ve made.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                checked={myOnly}
                data-testid="contest-board-my-only-toggle"
                onChange={(event) => setMyOnly(event.target.checked)}
                type="checkbox"
              />
              My entries only
            </label>
            {canCreateEntry ? (
              <button
                className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="contest-board-create-entry"
                disabled={enterContestMutation.isPending}
                onClick={() => void enterContestMutation.mutateAsync()}
                type="button"
              >
                {enterContestMutation.isPending ? 'Creating...' : 'Create entry'}
              </button>
            ) : null}
          </div>
        </div>

        {enterContestMutation.isError ? (
          <p className="mt-3 text-sm text-destructive" data-testid="contest-board-create-error">
            {extractErrorMessage(enterContestMutation.error, {
              fallback: 'We could not create that contest entry right now.',
            })}
          </p>
        ) : null}

        <div
          className="mt-5 space-y-3"
          data-testid="contest-board-entries"
        >
          {contestEntriesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading contest entries...</p>
          ) : contestEntriesQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load the current contest entries.
            </p>
          ) : visibleEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {myOnly
                ? 'Your team does not have an entry in this contest yet.'
                : 'No contest entries exist yet.'}
            </p>
          ) : (
            visibleEntries.map((entry) => {
              const isOwnEntry = myTeamId !== null && entry.squadId === myTeamId;
              const isExpanded = expandedEntryId === entry.id;
              const isRenaming = renameEntryId === entry.id;
              const canRename = isOwnEntry && isOpen;
              const showPicks = isExpanded && (picksRevealed || isOwnEntry);
              const showHiddenPlaceholder = isExpanded && !picksRevealed && !isOwnEntry;

              return (
                <div
                  className={`rounded-2xl border px-4 py-4 transition ${
                    isOwnEntry
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-background'
                  }`}
                  data-testid={`contest-board-entry-${entry.id}`}
                  key={entry.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {isOwnEntry ? (
                          <span aria-hidden className="text-primary" data-testid={`contest-board-entry-spotlight-${entry.id}`}>
                            ★
                          </span>
                        ) : null}
                        <span className="font-medium text-foreground">{entry.name}</span>
                        {isOwnEntry ? (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                            Your team
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {entry.squadName} · Entry {entry.entryNumber} · {entry.picksCount} picks made
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="text-right text-sm text-muted-foreground">
                        <div>{entry.standingsPosition ? `#${entry.standingsPosition}` : 'Rank pending'}</div>
                        <div>{entry.totalScore} pts</div>
                      </div>
                      <button
                        className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground"
                        data-testid={`contest-board-toggle-${entry.id}`}
                        onClick={() =>
                          setExpandedEntryId((current) =>
                            current === entry.id ? null : entry.id,
                          )}
                        type="button"
                      >
                        {isExpanded ? 'Hide' : 'View'}
                      </button>
                      {isOwnEntry && isOpen ? (
                        <Link
                          aria-label={`Edit ${entry.name}`}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border text-foreground hover:border-foreground/30"
                          data-testid={`contest-board-edit-entry-${entry.id}`}
                          state={{ leagueCode: hintedLeagueCode }}
                          title="Edit entry"
                          to={
                            hintedLeagueCode
                              ? buildLeagueContestEntryPath(hintedLeagueCode, contestId, entry.id)
                              : buildContestEntryPath(contestId, entry.id)
                          }
                        >
                          <Pencil aria-hidden size={16} />
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {canRename ? (
                    isRenaming ? (
                      <div className="mt-4 space-y-2 rounded-2xl border border-border bg-card px-4 py-4">
                        <label className="block space-y-2">
                          <span className="text-sm font-medium text-foreground">Entry name</span>
                          <input
                            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                            data-testid={`contest-board-rename-input-${entry.id}`}
                            disabled={renameEntryMutation.isPending}
                            maxLength={100}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            value={renameDraft}
                          />
                        </label>
                        <div className="flex flex-wrap gap-3">
                          <button
                            className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid={`contest-board-rename-save-${entry.id}`}
                            disabled={!renameDraft.trim() || renameEntryMutation.isPending}
                            onClick={() =>
                              void renameEntryMutation.mutateAsync({
                                entryId: entry.id,
                                name: renameDraft.trim(),
                              })
                            }
                            type="button"
                          >
                            {renameEntryMutation.isPending ? 'Saving...' : 'Save name'}
                          </button>
                          <button
                            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                            data-testid={`contest-board-rename-cancel-${entry.id}`}
                            disabled={renameEntryMutation.isPending}
                            onClick={cancelRenameEntry}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                        {renameEntryMutation.isError ? (
                          <p className="text-sm text-destructive">
                            {extractErrorMessage(renameEntryMutation.error)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-3">
                        <button
                          className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground"
                          data-testid={`contest-board-rename-${entry.id}`}
                          onClick={() => startRenameEntry(entry)}
                          type="button"
                        >
                          Rename entry
                        </button>
                      </div>
                    )
                  ) : null}

                  {showPicks && entry.participants ? (
                    <ParticipantsTable entryId={entry.id} participants={entry.participants} />
                  ) : null}

                  {showHiddenPlaceholder ? (
                    <div
                      className="mt-4 rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground"
                      data-testid={`contest-board-picks-hidden-${entry.id}`}
                    >
                      Picks hidden until the contest moves past OPEN. {entry.picksCount} picks made so far.
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6" id="contest-rules">
        <h3 className="text-xl font-semibold">Contest rules and snapshot</h3>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-sm text-muted-foreground">
          <div className="rounded-2xl bg-background px-4 py-4">
            <dt>Contest type</dt>
            <dd className="mt-1 font-semibold text-foreground">{contest.contestType}</dd>
          </div>
          <div className="rounded-2xl bg-background px-4 py-4">
            <dt>Selection type</dt>
            <dd className="mt-1 font-semibold text-foreground">{contest.selectionType}</dd>
          </div>
          <div className="rounded-2xl bg-background px-4 py-4">
            <dt>Scoring engine</dt>
            <dd className="mt-1 font-semibold text-foreground">{contest.scoringEngine}</dd>
          </div>
          <div className="rounded-2xl bg-background px-4 py-4">
            <dt>Status</dt>
            <dd className="mt-1 font-semibold text-foreground">{contest.status}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

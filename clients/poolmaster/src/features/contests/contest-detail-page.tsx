import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  getContest,
  getContestEntry,
  getLeague,
  getStandings,
  listContestEntries,
  type GetContestEntryResponses,
  type GetContestResponses,
  type GetStandingsResponses,
  type ListContestEntriesResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  buildLeagueContestManagePath,
  buildLeagueEntriesPath,
  buildLeaguePath,
} from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';

type ContestDetail = GetContestResponses[200]['contest'];
type LeaderboardEntry = GetStandingsResponses[200]['standings'][number];
type ContestEntrySummary = ListContestEntriesResponses[200]['entries'][number];
type ContestEntryDetail = GetContestEntryResponses[200]['entry'];

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
  const logger = useLogger().child({
    feature: 'contest-detail-page',
  });
  const { contestId = '', leagueCode: routeLeagueCode } = useParams<{
    contestId: string;
    leagueCode?: string;
  }>();
  const location = useLocation();
  const auth = useAuth();
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;
  const [expandedLeaderboardEntryId, setExpandedLeaderboardEntryId] = useState<string | null>(null);

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
  const myEntriesPath =
    hintedLeagueCode || leagueCodeQuery.data?.leagueCode
      ? buildLeagueEntriesPath(hintedLeagueCode ?? leagueCodeQuery.data!.leagueCode)
      : null;

  useEffect(() => {
    if (!contestQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'contestDetail.contest.failed',
        data: {
          contestId,
          leagueCode: hintedLeagueCode ?? null,
        },
        err: contestQuery.error,
      },
      'Contest detail failed to load contest data',
    );
  }, [contestId, contestQuery.error, contestQuery.isError, hintedLeagueCode, logger]);

  useEffect(() => {
    if (!contestQuery.data || !contestEntriesQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestDetail.page.loaded',
        data: {
          contestId,
          leagueCode: hintedLeagueCode ?? leagueCodeQuery.data?.leagueCode ?? null,
          status: contestQuery.data.status,
          entryCount: contestEntriesQuery.data.entries.length,
          isJoined: contestEntriesQuery.data.isJoined,
        },
      },
      'Contest detail page loaded',
    );
  }, [
    contestEntriesQuery.data,
    contestId,
    contestQuery.data,
    hintedLeagueCode,
    leagueCodeQuery.data?.leagueCode,
    logger,
  ]);

  const displayedEntries = contestEntriesQuery.data?.entries ?? [];
  const currentUserEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const isJoined = contestEntriesQuery.data?.isJoined ?? false;

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

  const contest = contestQuery.data;
  const isPostEventLeaderboard =
    contest.status === 'ACTIVE' || contest.status === 'COMPLETED';

  return (
    <section className="space-y-6">
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
              <dt>Entries</dt>
              <dd className="mt-1 font-semibold text-foreground">{contest.entryCount ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-6">
          <h3 className="text-xl font-semibold">My entries</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Contest Home now stays focused on rules, all entries, and the leaderboard. Create and rename actions live on the dedicated My Entries page.
          </p>
          {myEntriesPath ? (
            <Link
              className="mt-5 inline-flex rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
              data-testid="contest-open-my-entries"
              to={myEntriesPath}
            >
              Open My Entries
            </Link>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              We&apos;ll link your league entries page here once the league context finishes loading.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">
              {isPostEventLeaderboard ? 'Leaderboard' : 'All entries'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {isPostEventLeaderboard
                ? 'Contest Home becomes the leaderboard once scoring is underway. Expand a row to inspect the picked lineup.'
                : 'Contest Home keeps the full entry directory here until scoring begins. Your own rows link back to My Entries; non-self rows stay read-only.'}
            </p>
          </div>
          <a
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
            data-testid="contest-view-rules"
            href="#contest-rules"
          >
            View rules
          </a>
        </div>
        <div
          className="mt-5 space-y-3"
          data-testid={isPostEventLeaderboard ? 'contest-leaderboard' : 'contest-entry-list'}
        >
          {isPostEventLeaderboard ? (
            leaderboardQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading leaderboard...</p>
            ) : leaderboardQuery.isError ? (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load the leaderboard for this contest.
              </p>
            ) : leaderboardQuery.data?.length ? (
              leaderboardQuery.data.map((entry) => {
                const isExpanded = expandedLeaderboardEntryId === entry.entryId;

                return (
                  <div
                    className="rounded-2xl border border-border bg-background px-4 py-4"
                    data-testid={`contest-leaderboard-entry-${entry.entryId}`}
                    key={entry.entryId}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium text-foreground">{entry.entryName}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {entry.ownerDisplayName}
                          {entry.isEliminated ? ' · Eliminated' : ''}
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="text-right">
                          <div className="text-lg font-semibold text-foreground">#{entry.rank}</div>
                          <div className="text-sm text-muted-foreground">{entry.totalScore}</div>
                        </div>
                        <button
                          className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground"
                          data-testid={`contest-leaderboard-toggle-${entry.entryId}`}
                          onClick={() =>
                            setExpandedLeaderboardEntryId((current) =>
                              current === entry.entryId ? null : entry.entryId,
                            )}
                          type="button"
                        >
                          {isExpanded ? 'Hide lineup' : 'View lineup'}
                        </button>
                      </div>
                    </div>
                    <ContestLeaderboardEntryDetail
                      contestId={contestId}
                      enabled={isExpanded}
                      entryId={entry.entryId}
                    />
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No leaderboard entries yet.</p>
            )
          ) : contestEntriesQuery.isLoading ? (
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
                    <div className="flex items-start gap-3">
                      <div className="text-right text-sm text-muted-foreground">
                        <div>{entry.standingsPosition ? `#${entry.standingsPosition}` : 'Rank pending'}</div>
                        <div>{entry.totalScore} pts</div>
                      </div>
                      {isCurrentUserEntry && myEntriesPath ? (
                        <Link
                          className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground"
                          data-testid={`contest-entry-open-my-entries-${entry.id}`}
                          to={myEntriesPath}
                        >
                          Open in My Entries
                        </Link>
                      ) : null}
                    </div>
                  </div>
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

import { useQuery } from '@tanstack/react-query';
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
import { getLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';
import {
  Alert,
  Button,
  Chip,
  DefinitionList,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LinkButton,
  LoadingState,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import { shouldPollContestEntries } from './contest-status';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

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
      <Alert className="mt-4">
        This entry does not have any picked participants yet.
      </Alert>
    );
  }

  return (
    <Tile className="mt-4 overflow-x-auto" padding="none" radius="lg">
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
              key={participant.pickId}
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
                <span className="text-right text-muted-foreground" key={`${participant.pickId}-round-${index + 1}`}>
                  {roundScore}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

export function ContestDetailPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const logger = getLogger().child({
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
    queryKey: QueryKeys.contests.detail(contestId),
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
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: async (): Promise<ListContestEntriesResponses[200]> => {
      const response = await listContestEntries({ path: { contestId } });

      if (!response.data) {
        throw response.error ?? new Error('Contest entries response is missing data.');
      }

      return response.data;
    },
    enabled: Boolean(contestId),
    retry: false,
    refetchInterval: shouldPollContestEntries(contestQuery.data?.status) ? 30_000 : false,
  });

  const leagueId = contestQuery.data?.leagueId ?? '';

  const teamsQuery = useQuery({
    queryKey: QueryKeys.leagueTeams.byLeague(leagueId),
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

  const enterContestMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await enterContest({ path: { contestId } });
      if (!response.data?.entry) {
        throw response.error ?? new Error('Contest entry creation response is missing data.');
      }
      return response.data.entry;
    },
    onSuccess: async (entry) => {
      navigate(
        hintedLeagueCode
          ? buildLeagueContestEntryPath(hintedLeagueCode, contestId, entry.id)
          : buildContestEntryPath(contestId, entry.id),
        {
        state: { leagueCode: hintedLeagueCode },
        },
      );
    },
    invalidates: [QueryKeys.contestEntries.byContest(contestId)],
  });

  const renameEntryMutation = useInvalidatingMutation({
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
    },
    invalidates: [QueryKeys.contestEntries.byContest(contestId)],
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
    return <LoadingState body="Loading contest detail..." />;
  }

  if (contestQuery.isError || !contestQuery.data) {
    return (
      <ErrorState
        body="Try refreshing or return to League Home."
        title="We couldn't load this contest."
      />
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
      <Tile padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <StatusBadge tone={isOpen ? 'active' : 'neutral'}>
              {contest.status}
            </StatusBadge>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight" data-testid="contest-detail-heading">
                {contest.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-detail-summary">
                {contest.selectionType} · {contest.scoringEngine}
                {contest.sport ? ` · ${contest.sport}` : ''}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <Chip
                  data-testid="contest-board-my-count"
                  tone="info"
                >
                  My Entries: <span className="font-semibold text-foreground">{myCount}</span>
                </Chip>
                <Chip
                  data-testid="contest-board-total-count"
                  tone="info"
                >
                  Total Entries: <span className="font-semibold text-foreground">{totalCount}</span>
                </Chip>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {manageContestPath ? (
              <LinkButton
                data-testid="contest-manage-link"
                to={manageContestPath}
                variant="secondary"
              >
                Manage contest
              </LinkButton>
            ) : null}
            <LinkButton
              data-testid="contest-back-to-league"
              to={backToLeaguePath}
              variant="secondary"
            >
              Back to league
            </LinkButton>
          </div>
        </div>
      </Tile>

      <Tile>
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
              <Button
                data-testid="contest-board-create-entry"
                disabled={enterContestMutation.isPending}
                onClick={() => void enterContestMutation.mutateAsync()}
              >
                {enterContestMutation.isPending ? 'Creating...' : 'Create entry'}
              </Button>
            ) : null}
          </div>
        </div>

        {enterContestMutation.isError ? (
          <Alert className="mt-3" data-testid="contest-board-create-error" tone="danger">
            {extractErrorMessage(enterContestMutation.error, {
              fallback: 'We could not create that contest entry right now.',
            })}
          </Alert>
        ) : null}

        <div
          className="mt-5 space-y-3"
          data-testid="contest-board-entries"
        >
          {contestEntriesQuery.isLoading ? (
            <LoadingState body="Loading contest entries..." />
          ) : contestEntriesQuery.isError ? (
            <ErrorState body="We couldn't load the current contest entries." />
          ) : visibleEntries.length === 0 ? (
            <EmptyState
              body={
                myOnly
                  ? 'Your team does not have an entry in this contest yet.'
                  : 'No contest entries exist yet.'
              }
            />
          ) : (
            visibleEntries.map((entry) => {
              const isOwnEntry = myTeamId !== null && entry.squadId === myTeamId;
              const isExpanded = expandedEntryId === entry.id;
              const isRenaming = renameEntryId === entry.id;
              const canRename = isOwnEntry && isOpen;
              const showPicks = isExpanded && (picksRevealed || isOwnEntry);
              const showHiddenPlaceholder = isExpanded && !picksRevealed && !isOwnEntry;

              return (
                <Tile
                  className={isOwnEntry ? 'border-primary/40 bg-primary/5' : undefined}
                  data-testid={`contest-board-entry-${entry.id}`}
                  key={entry.id}
                  padding="sm"
                  radius="lg"
                  variant="subtle"
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
                          <Chip tone="active">
                            Your team
                          </Chip>
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
                      <Button
                        data-testid={`contest-board-toggle-${entry.id}`}
                        onClick={() =>
                          setExpandedEntryId((current) =>
                            current === entry.id ? null : entry.id,
                          )}
                        size="sm"
                        variant="secondary"
                      >
                        {isExpanded ? 'Hide' : 'View'}
                      </Button>
                      {isOwnEntry && isOpen ? (
                        <Button
                          aria-label={`Edit ${entry.name}`}
                          asChild
                          data-testid={`contest-board-edit-entry-${entry.id}`}
                          size="icon"
                          variant="icon"
                        >
                          <Link
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
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {canRename ? (
                    isRenaming ? (
                      <Tile className="mt-4 space-y-3" padding="sm" radius="lg" variant="default">
                        <FormField label="Entry name">
                          <Input
                            data-testid={`contest-board-rename-input-${entry.id}`}
                            disabled={renameEntryMutation.isPending}
                            maxLength={100}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            value={renameDraft}
                          />
                        </FormField>
                        <div className="flex flex-wrap gap-3">
                          <Button
                            data-testid={`contest-board-rename-save-${entry.id}`}
                            disabled={!renameDraft.trim() || renameEntryMutation.isPending}
                            isLoading={renameEntryMutation.isPending}
                            onClick={() =>
                              void renameEntryMutation.mutateAsync({
                                entryId: entry.id,
                                name: renameDraft.trim(),
                              })
                            }
                          >
                            {renameEntryMutation.isPending ? 'Saving...' : 'Save name'}
                          </Button>
                          <Button
                            data-testid={`contest-board-rename-cancel-${entry.id}`}
                            disabled={renameEntryMutation.isPending}
                            onClick={cancelRenameEntry}
                            variant="secondary"
                          >
                            Cancel
                          </Button>
                        </div>
                        {renameEntryMutation.isError ? (
                          <Alert tone="danger">
                            {extractErrorMessage(renameEntryMutation.error)}
                          </Alert>
                        ) : null}
                      </Tile>
                    ) : (
                      <div className="mt-3">
                        <Button
                          data-testid={`contest-board-rename-${entry.id}`}
                          onClick={() => startRenameEntry(entry)}
                          size="sm"
                          variant="secondary"
                        >
                          Rename entry
                        </Button>
                      </div>
                    )
                  ) : null}

                  {showPicks && entry.participants ? (
                    <ParticipantsTable entryId={entry.id} participants={entry.participants} />
                  ) : null}

                  {showHiddenPlaceholder ? (
                    <Alert
                      className="mt-4"
                      data-testid={`contest-board-picks-hidden-${entry.id}`}
                    >
                      Picks hidden until the contest moves past OPEN. {entry.picksCount} picks made so far.
                    </Alert>
                  ) : null}
                </Tile>
              );
            })
          )}
        </div>
      </Tile>

      <Tile id="contest-rules">
        <h3 className="text-xl font-semibold">Contest rules and snapshot</h3>
        <DefinitionList
          className="mt-5"
          items={[
            { id: 'contest-format', label: 'Contest format', value: contest.contestFormat },
            { id: 'selection-type', label: 'Selection type', value: contest.selectionType },
            { id: 'scoring-engine', label: 'Scoring engine', value: contest.scoringEngine },
            { id: 'status', label: 'Status', value: contest.status },
          ]}
        />
      </Tile>
    </section>
  );
}

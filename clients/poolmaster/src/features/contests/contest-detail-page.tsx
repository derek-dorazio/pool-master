import {
  ContestEntryStatus,
  ContestStatus,
  type Sport,
  formatParticipantStatusLabel,
  formatSelectionTypeName,
} from '@poolmaster/shared/domain';
import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { enterContest, updateContestEntry, type ContestEntryDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import {
  buildLeagueAdminContestPath,
  buildLeagueContestEntryPath,
} from '@/features/leagues/league-routing';
import { buildHowToPlayFormatPath } from '@/features/event-pages/event-page-paths';
import { formatPlanLimit } from '@/features/plans/plan-labels';
import { getLogger } from '@/lib/logger';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  DateDisplay,
  DefinitionList,
  EmptyState,
  ErrorState,
  FormField,
  Heading,
  Input,
  LinkButton,
  LoadingState,
  Tile,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { currentContestEvent, entryEventStatus } from './contest-events';
import { ContestPageFrame } from './contest-header';
import { EntryDetailsPeek } from './entry-details-peek';
import { MY_ENTRIES_PARAM } from './contest-page-view';
import {
  areContestEntriesOpen,
  CONTEST_ENTRY_STATUS_LABELS,
  CONTEST_ENTRY_STATUS_TONES,
} from './contest-status';
import { contestSchedule } from './use-contest-schedule';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { entryWriteKeys, useContestEntriesQuery } from './use-contest-entries';
import { useContestLeague } from './use-contest-league';
import { useLiveContestQuery } from './use-contest-query';

type ContestEntryParticipant = NonNullable<ContestEntryDto['participants']>[number];

function sortDetailedParticipants(participants: ContestEntryParticipant[]) {
  // pool-master-eux.5 removed the legacy score blob that previously implied
  // finish order here. Keep this generic contest detail view alphabetical; #110's
  // leaderboard page owns score/rank ordering.
  return [...participants].sort((left, right) =>
    left.participantName.localeCompare(right.participantName),
  );
}

function ParticipantsTable({
  entryId,
  participants,
  sport,
}: {
  entryId: string;
  participants: ContestEntryParticipant[];
  sport: Sport | null | undefined;
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
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] gap-2 border-b border-border px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
        <span>Participant</span>
        <span>Status</span>
        <span>Affiliation</span>
      </div>
      <div className="divide-y divide-border">
        {sorted.map((participant) => {
          return (
            <div
              className="grid grid-cols-[minmax(0,1.5fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] gap-2 px-4 py-3 text-sm"
              data-testid={`contest-entry-pick-${entryId}-${participant.participantId}`}
              key={participant.pickId}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{participant.participantName}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {participant.participantStatus
                    ? `Status: ${formatParticipantStatusLabel(participant.participantStatus, sport)}`
                    : participant.teamAffiliation ?? participant.role ?? 'Contest participant'}
                </div>
              </div>
              <span className="text-muted-foreground">
                {participant.participantStatus
                  ? formatParticipantStatusLabel(participant.participantStatus, sport)
                  : 'Active'}
              </span>
              <span className="text-muted-foreground">
                {participant.teamAffiliation ?? participant.role ?? '—'}
              </span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

export function ContestDetailPage() {
  const navigate = useNavigate();
  const logger = getLogger().child({
    feature: 'contest-board',
  });
  const { contestId = '' } = useParams<{ contestId: string }>();
  const { locale } = useDisplayPreferences();
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  // My entries (#1392) opens this page with `?mine=1`; the checkbox keeps the link in step.
  const [searchParams, setSearchParams] = useSearchParams();
  const myOnly = searchParams.get(MY_ENTRIES_PARAM) === '1';
  const [renameEntryId, setRenameEntryId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const contestQuery = useLiveContestQuery(contestId, () => QueryKeys.contestEntries.byContest(contestId));

  const contestEntriesQuery = useContestEntriesQuery(contestId, contestQuery.data?.status);

  const leagueId = contestQuery.data?.leagueId ?? '';
  const schedule = contestSchedule(contestQuery.data);

  /*
   * #202 (A8) — the viewer's own squad comes from their squad membership, which the
   * league-context read delivers once.
   *
   * The squad-list query that stood here is GONE, not rewritten: this page fetched every squad
   * in the league and scanned each one's member list for the signed-in user, for the sole
   * purpose of learning which squad is theirs. One request replaces it, and it is one this page
   * benefits from caching anyway.
   */
  const { leagueCode, viewer } = useContestLeague(leagueId || undefined);
  const myTeamId = viewer.mySquadId;

  const enterContestMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await enterContest({ path: { contestId } });
      if (!response.data?.entry) {
        throwApiError(response.error, 'Contest entry creation response is missing data.');
      }
      return response.data.entry;
    },
    onSuccess: (entry) => {
      void navigate(buildLeagueContestEntryPath(leagueCode, contestId, entry.id));
    },
    invalidates: entryWriteKeys(contestId),
  });

  const renameEntryMutation = useInvalidatingMutation({
    mutationFn: async ({ entryId, name }: { entryId: string; name: string }) => {
      const response = await updateContestEntry({
        path: { contestId, entryId },
        body: { name },
      });
      if (!response.data?.entry) {
        throwApiError(response.error, 'Contest entry rename response is missing data.');
      }
      return response.data.entry;
    },
    onSuccess: () => {
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
          leagueCode,
        },
        err: contestQuery.error,
      },
      'Contest Board failed to load contest data',
    );
  }, [contestId, contestQuery.error, contestQuery.isError, leagueCode, logger]);

  useEffect(() => {
    if (!contestQuery.data || !contestEntriesQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestBoard.page.loaded',
        data: {
          contestId,
          leagueCode,
          status: contestQuery.data.status,
          entryCount: contestEntriesQuery.data.entries.length,
          myEntryCount: contestQuery.data.myEntryIds?.length ?? 0,
          picksRevealed: contestEntriesQuery.data.picksRevealed,
        },
      },
      'Contest Board page loaded',
    );
  }, [
    contestEntriesQuery.data,
    contestId,
    contestQuery.data,
    leagueCode,
    logger,
  ]);

  if (contestQuery.isLoading) {
    return <LoadingState body="Loading contest detail..." />;
  }

  if (contestQuery.isError || !contestQuery.data) {
    return (
      <ErrorState
        body="We couldn't load this contest."
        onRetry={() => void contestQuery.refetch()}
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
  const entriesOpen = areContestEntriesOpen(contest, schedule?.startsAt);
  const isDraft = contest.status === ContestStatus.DRAFT;
  // Each event takes its own submitted picks (#713): the board shows the current event's.
  const currentEventId = currentContestEvent(contest)?.sportEventId;
  // The contest's cap, every squad's drafts included: its plan's (#947), or its expansion (#987).
  const entryCap = contest.entriesPerContest;
  const isFull = entryCap !== null && totalCount >= entryCap;
  const canCreateEntry = entriesOpen && Boolean(myTeamId) && !isFull;


  function startRenameEntry(entry: ContestEntryDto) {
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
    <ContestPageFrame
      contest={contest}
      current={myOnly && (contest.myEntryIds?.length ?? 0) > 1 ? 'my-entry' : 'entries'}
      headerTestId="contest-detail-header"
      leagueCode={leagueCode}
      picksRevealed={picksRevealed}
      summary={(
        <>
          <span data-testid="contest-detail-summary">{formatSelectionTypeName(contest.selectionType)}</span>
          {schedule ? (
            <span data-testid="contest-detail-schedule">
              <span data-testid="contest-detail-starts">
                Starts <DateDisplay className="text-muted-foreground" value={schedule.startsAt} />
              </span>
              {schedule.endsAt ? (
                <span data-testid="contest-detail-ends">
                  {' · '}Ends <DateDisplay className="text-muted-foreground" value={schedule.endsAt} />
                </span>
              ) : null}
            </span>
          ) : null}
          <span data-testid="contest-board-total-count">
            Entries: {entryCap === null ? formatNumber(totalCount, locale) : `${formatNumber(totalCount, locale)} of ${formatPlanLimit(entryCap, locale)}`}
          </span>
          <span data-testid="contest-board-my-count">My entries: {myCount}</span>
        </>
      )}
      testId="contest-board"
    >

      {isDraft ? (
        <Alert data-testid="contest-draft-note">
          This contest is a draft. Only commissioners can see it, and nobody can enter until it is
          opened to the league.
        </Alert>
      ) : null}

      <Tile>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level={3} variant="card" size="xl" tone="inherit">Entries</Heading>
            <p className="mt-2 text-sm text-muted-foreground">
              {picksRevealed
                ? 'Picks are visible. Expand a row to see each entry’s lineup. Scores live on the leaderboard.'
                : 'Picks are hidden until the event starts. Your own entry expands to its picks; other entries show only how many picks they have.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Checkbox
                checked={myOnly}
                data-testid="contest-board-my-only-toggle"
                onChange={(event) => setSearchParams((params) => {
                  if (event.target.checked) {
                    params.set(MY_ENTRIES_PARAM, '1');
                  } else {
                    params.delete(MY_ENTRIES_PARAM);
                  }
                  return params;
                }, { replace: true })}
              />
              My entries only
            </label>
            {canCreateEntry ? (
              <Button
                data-testid="contest-board-create-entry"
                disabled={enterContestMutation.isPending}
                // The mutation's own error state shows a refusal.
                onClick={() => void enterContestMutation.mutateAsync().catch(() => undefined)}
              >
                {enterContestMutation.isPending ? 'Creating...' : 'Create entry'}
              </Button>
            ) : null}
          </div>
        </div>

        {entriesOpen && isFull ? (
          <Alert className="mt-3" data-testid="contest-board-full">
            This contest is full.
            {/* Members never see expansions or prices; its commissioners can expand it. */}
            {viewer.isCommissioner ? (
              <>
                {' '}
                <Link
                  className="font-medium text-primary underline"
                  data-testid="contest-board-full-expand-link"
                  to={buildLeagueAdminContestPath(leagueCode, contest.id)}
                >
                  Expand contest
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}

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
            <LoadingState rows={3} body="Loading contest entries..." />
          ) : contestEntriesQuery.isError ? (
            <ErrorState body="We couldn't load the current contest entries." onRetry={() => void contestEntriesQuery.refetch()} />
          ) : visibleEntries.length === 0 ? (
            <EmptyState
              body={
                myOnly
                  ? 'You don’t have an entry in this contest yet.'
                  : 'No contest entries exist yet.'
              }
            />
          ) : (
            visibleEntries.map((entry) => {
              const isOwnEntry = myTeamId !== null && entry.squadId === myTeamId;
              const isExpanded = expandedEntryId === entry.id;
              const isRenaming = renameEntryId === entry.id;
              const canRename = isOwnEntry && entriesOpen;
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
                        <span className="flex items-center">
                          <span className="font-medium text-foreground">{entry.name}</span>
                          <EntryDetailsPeek
                            className="-my-2"
                            entryName={entry.name}
                            leagueCode={leagueCode}
                            leagueId={contest.leagueId}
                            squadId={entry.squadId}
                            testId={`contest-board-entry-peek-${entry.id}`}
                          />
                        </span>
                        {isOwnEntry ? (
                          <Chip tone="active">
                            Yours
                          </Chip>
                        ) : null}
                        {entryEventStatus(entry, currentEventId) === ContestEntryStatus.SUBMITTED ? null : (
                          // A draft counts nowhere until it is submitted (#481).
                          <Chip
                            data-testid={`contest-board-entry-status-${entry.id}`}
                            tone={CONTEST_ENTRY_STATUS_TONES[ContestEntryStatus.DRAFT]}
                          >
                            {CONTEST_ENTRY_STATUS_LABELS[ContestEntryStatus.DRAFT]}
                          </Chip>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {entry.picksCount} picks made
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
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
                      {isOwnEntry && entriesOpen ? (
                        <Button
                          aria-label={`Edit ${entry.name}`}
                          asChild
                          data-testid={`contest-board-edit-entry-${entry.id}`}
                          size="icon"
                          variant="icon"
                        >
                          <Link
                            title="Edit entry"
                            to={buildLeagueContestEntryPath(leagueCode, contestId, entry.id)}
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
                              }).catch(() => undefined)
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
                    <ParticipantsTable entryId={entry.id} participants={entry.participants} sport={contest.sport} />
                  ) : null}

                  {showHiddenPlaceholder ? (
                    <Alert
                      className="mt-4"
                      data-testid={`contest-board-picks-hidden-${entry.id}`}
                    >
                      Picks hidden until the event starts. {entry.picksCount} picks made so far.
                    </Alert>
                  ) : null}
                </Tile>
              );
            })
          )}
        </div>
      </Tile>

      <Tile data-testid="contest-how-to-play">
        <Heading level={3} variant="card" size="xl" tone="inherit">How to play</Heading>
        <DefinitionList
          className="mt-5"
          items={[
            { id: 'way-to-play', label: 'Way to play', value: formatSelectionTypeName(contest.selectionType) },
            {
              id: 'events',
              label: contest.sportEvents.length === 1 ? 'Event' : 'Events',
              value: contest.sportEvents.map((sportEvent) => sportEvent.name).join(', '),
            },
          ]}
        />
        <LinkButton
          className="mt-5"
          data-testid="contest-how-to-play-link"
          to={buildHowToPlayFormatPath(contest.sport ?? null, contest.selectionType)}
          variant="secondary"
        >
          How to play this contest
        </LinkButton>
      </Tile>
    </ContestPageFrame>
  );
}

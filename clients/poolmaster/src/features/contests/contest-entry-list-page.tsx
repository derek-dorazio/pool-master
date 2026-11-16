import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  SelectionType,
  formatSelectionTypeName,
} from '@poolmaster/shared/domain';
import { Pencil } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import type { ContestDto, ContestEntryDto } from '@/lib/api';
import {
  buildLeagueAdminContestPath,
  buildLeagueContestEntryPath,
} from '@/features/leagues/league-routing';
import { buildHowToPlayFormatPath } from '@/features/event-pages/event-page-paths';
import { formatPlanLimit } from '@/features/plans/plan-labels';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import {
  Button,
  DateDisplay,
  EmptyState,
  ErrorState,
  ExpandableRow,
  HelpTip,
  LinkButton,
  LoadingState,
  Notice,
  PendingPage,
  SectionCard,
  Text,
  Tile,
  cn,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { currentContestEvent, entryEventStatus } from './contest-events';
import { ContestPageFrame } from './contest-header';
import { EntryDetailsPeek } from './entry-details-peek';
import { EntryDetailsToggle } from './entry-details-toggle';
import { useOpenEntryRows } from './use-open-entry-rows';
import { MineMarker } from './mine-marker';
import { areContestEntriesOpen } from './contest-status';
import { SquaresBoardView } from './squares-board-view';
import { StartEntryButton } from './start-entry-button';
import { contestSchedule } from './use-contest-schedule';
import { useContestEntriesQuery } from './use-contest-entries';
import { useContestLeague } from './use-contest-league';
import { useLiveContestQuery } from './use-contest-query';

/**
 * Whether an entry row of this contest opens to its picks on the entry list. A lineup's does;
 * pick'em, survivor, bracket and squares rows are still in design (#1739), so the viewer's own
 * open their pick screen through ✎ instead.
 */
function opensToPicks(contest: Pick<ContestDto, 'contestFormat'>) {
  return contest.contestFormat === ContestFormat.ROSTER;
}

/** An entry's own line under its name: submitted, or a draft and how many picks it holds. */
function describeOwnEntry(entry: ContestEntryDto, currentEventId: string | undefined) {
  return entryEventStatus(entry, currentEventId) === ContestEntryStatus.SUBMITTED
    ? 'Submitted'
    : `Draft · ${formatPickCount(entry.picksCount)}`;
}

function formatPickCount(count: number) {
  return count === 1 ? '1 pick' : `${String(count)} picks`;
}

/** One entry's picks, opened under the viewer's own row: each pick's name, and its team where it has one. */
function EntryPicks({ entry }: { entry: ContestEntryDto }) {
  const participants = [...(entry.participants ?? [])].sort((left, right) => left.participantName.localeCompare(right.participantName));
  if (participants.length === 0) {
    return <Text as="p" className="px-4 py-3" tone="muted" variant="meta">No picks yet.</Text>;
  }
  return (
    <div className="divide-y divide-border" data-testid={`contest-entry-picks-${entry.id}`}>
      {participants.map((participant) => (
        <div
          className="flex items-baseline justify-between gap-3 px-4 py-2"
          data-testid={`contest-entry-pick-${entry.id}-${participant.participantId}`}
          key={participant.pickId}
        >
          <Text variant="body">{participant.participantName}</Text>
          {participant.teamAffiliation ? <Text tone="muted" variant="meta">{participant.teamAffiliation}</Text> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * One entry on the list: its name and (i) peek, and for the viewer's own, the Yours mark, its
 * status and ✎ to its pick screen, where both its picks and its name change.
 */
function EntryRow({
  canEdit,
  contest,
  currentEventId,
  entry,
  isMine,
  isOpen,
  leagueCode,
  onToggle,
}: {
  canEdit: boolean;
  contest: ContestDto;
  currentEventId: string | undefined;
  entry: ContestEntryDto;
  isMine: boolean;
  isOpen: boolean;
  leagueCode: string;
  onToggle: () => void;
}) {
  const summary = (
    <div className="flex items-center justify-between gap-3">
      <span className="block min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex items-center">
            <Text variant="strong">{entry.name}</Text>
            <EntryDetailsPeek
              className="-my-2"
              entryName={entry.name}
              leagueCode={leagueCode}
              leagueId={contest.leagueId}
              squadId={entry.squadId}
              testId={`contest-board-entry-peek-${entry.id}`}
            />
          </span>
          {isMine ? <MineMarker /> : null}
        </span>
        {isMine ? (
          <Text as="span" className="mt-1 block" data-testid={`contest-board-entry-status-${entry.id}`} tone="muted" variant="caption">
            {describeOwnEntry(entry, currentEventId)}
          </Text>
        ) : null}
      </span>
      {isMine && canEdit ? (
        <Button
          aria-label={`Edit ${entry.name}`}
          asChild
          data-testid={`contest-board-edit-entry-${entry.id}`}
          size="icon"
          variant="icon"
        >
          <Link title="Edit picks and name" to={buildLeagueContestEntryPath(leagueCode, contest.id, entry.id)}>
            <Pencil aria-hidden size={16} />
          </Link>
        </Button>
      ) : null}
    </div>
  );

  return (
    <Tile
      className={cn('overflow-clip', isMine ? 'border-primary/40' : undefined)}
      data-mine={isMine || undefined}
      data-testid={`contest-board-entry-${entry.id}`}
      padding="none"
      variant="subtle"
    >
      {isMine && opensToPicks(contest) ? (
        <ExpandableRow
          isOpen={isOpen}
          label={`Picks for ${entry.name}`}
          look="bar"
          onToggle={onToggle}
          rowTestId={`contest-board-entry-bar-${entry.id}`}
          summary={summary}
          toggleTestId={`contest-board-toggle-${entry.id}`}
        >
          <EntryPicks entry={entry} />
        </ExpandableRow>
      ) : (
        <div className="bg-muted px-4 py-3" data-testid={`contest-board-entry-bar-${entry.id}`}>{summary}</div>
      )}
    </Tile>
  );
}

/**
 * A contest's page while entries are open (#1739): the entries laid out like the leaderboard,
 * names only. Other teams' entries are listed once submitted (the server leaves their drafts
 * out); the viewer's own come first, highlighted, open to their picks, with ✎ to the pick screen.
 * The header's button starts another entry straight on its pick screen while more are allowed;
 * once the contest is full a notice stands there instead.
 */
export function ContestEntryListPage() {
  const logger = getLogger().child({ feature: 'contest-board' });
  const { contestId = '' } = useParams<{ contestId: string }>();
  const { locale } = useDisplayPreferences();

  const contestQuery = useLiveContestQuery(contestId, () => QueryKeys.contestEntries.byContest(contestId));
  const contestEntriesQuery = useContestEntriesQuery(contestId, contestQuery.data?.status);
  const { leagueCode, viewer } = useContestLeague(contestQuery.data?.leagueId || undefined);
  const myTeamId = viewer.mySquadId;
  const myEntryIds = (contestEntriesQuery.data?.entries ?? [])
    .filter((entry) => myTeamId !== null && entry.squadId === myTeamId)
    .map((entry) => entry.id);
  const openRows = useOpenEntryRows(myEntryIds);

  useEffect(() => {
    if (contestQuery.isError) {
      logger.warn(
        { action: 'contestBoard.contest.failed', data: { contestId, leagueCode }, err: contestQuery.error },
        'Contest Board failed to load contest data',
      );
    }
  }, [contestId, contestQuery.error, contestQuery.isError, leagueCode, logger]);

  if (contestQuery.isLoading) {
    return <PendingPage testId="contest-detail-pending"><LoadingState body="Loading contest detail..." /></PendingPage>;
  }
  if (contestQuery.isError || !contestQuery.data) {
    return (
      <PendingPage testId="contest-detail-pending">
        <ErrorState body="We couldn't load this contest." onRetry={() => void contestQuery.refetch()} />
      </PendingPage>
    );
  }

  const contest = contestQuery.data;
  const schedule = contestSchedule(contest);
  const entries = contestEntriesQuery.data?.entries ?? [];
  const entriesOpen = areContestEntriesOpen(contest, schedule?.startsAt);
  // Each event takes its own submitted picks (#713): an entry's status is the current event's.
  const currentEventId = currentContestEvent(contest)?.sportEventId;
  // The cap counts every team's drafts too: its plan's (#947), or its expansion (#987).
  const entryCount = contest.allEntryCount ?? entries.length;
  const entryCap = contest.entriesPerContest;
  const isFull = entryCap !== null && entryCount >= entryCap;
  const canCreateEntry = entriesOpen && Boolean(myTeamId) && !isFull;
  const hasMine = myEntryIds.length > 0;
  const expandableIds = opensToPicks(contest) ? myEntryIds : [];
  const countFigure = entryCap === null
    ? formatNumber(entryCount, locale)
    : `${formatNumber(entryCount, locale)} of ${formatPlanLimit(entryCap, locale)}`;

  return (
    <ContestPageFrame
      actions={canCreateEntry ? (
        <StartEntryButton
          contestId={contest.id}
          label={hasMine ? 'Create another entry' : 'Make your picks'}
          leagueCode={leagueCode}
          testId="contest-board-create-entry"
        />
      ) : null}
      contest={contest}
      headerTestId="contest-detail-header"
      leagueCode={leagueCode}
      summary={(
        <>
          <span className="inline-flex items-center" data-testid="contest-detail-summary">
            {formatSelectionTypeName(contest.selectionType)}
            <HelpTip
              className="-my-2"
              label={`How ${formatSelectionTypeName(contest.selectionType)} works`}
              learnMore={{ label: 'How to play', to: buildHowToPlayFormatPath(contest.sport ?? null, contest.selectionType) }}
              testId="contest-how-to-play"
            >
              {`How a ${formatSelectionTypeName(contest.selectionType)} contest is played and scored.`}
            </HelpTip>
          </span>
          {schedule ? (
            <span data-testid="contest-detail-schedule">
              <span data-testid="contest-detail-starts">
                Starts <DateDisplay tone="inherit" value={schedule.startsAt} />
              </span>
              {schedule.endsAt ? (
                <span data-testid="contest-detail-ends">
                  {' · '}Ends <DateDisplay tone="inherit" value={schedule.endsAt} />
                </span>
              ) : null}
            </span>
          ) : null}
          <span data-testid="contest-board-total-count">{`${countFigure} entered`}</span>
        </>
      )}
      testId="contest-board"
    >
      {contest.status === ContestStatus.DRAFT ? (
        <Notice data-testid="contest-draft-note">
          This contest is a draft. Only commissioners can see it, and nobody can enter until it is
          opened to the league.
        </Notice>
      ) : null}

      {entriesOpen && isFull ? (
        <Notice data-testid="contest-board-full">
          {`This contest is full · ${countFigure}`}
          {/* Members never see expansions or prices; its commissioners can expand it. */}
          {viewer.isCommissioner ? (
            <>
              {' '}
              <LinkButton
                data-testid="contest-board-full-expand-link"
                to={buildLeagueAdminContestPath(leagueCode, contest.id)}
                variant="link"
              >
                Expand contest
              </LinkButton>
            </>
          ) : null}
        </Notice>
      ) : null}

      {/* A squares contest's board is its entries' boxes: it stays above the list. */}
      {contest.selectionType === SelectionType.SQUARES ? (
        <SquaresBoardView canManage={viewer.isCommissioner || viewer.isRootAdmin} contest={contest} myEntryIds={contest.myEntryIds ?? []} />
      ) : null}

      <SectionCard bare testId="contest-board-entries-section" title="Entries">
        {expandableIds.length > 0 ? (
          <div className="flex justify-end">
            <EntryDetailsToggle
              allOpen={openRows.allOpen(expandableIds)}
              onToggle={(open) => openRows.setAll(expandableIds, open)}
              testId="contest-board-toggle-all"
            />
          </div>
        ) : null}
        <div className="space-y-3" data-testid="contest-board-entries">
          {contestEntriesQuery.isLoading ? (
            <LoadingState rows={3} body="Loading contest entries..." />
          ) : contestEntriesQuery.isError ? (
            <ErrorState body="We couldn't load the current contest entries." onRetry={() => void contestEntriesQuery.refetch()} />
          ) : entries.length === 0 ? (
            <EmptyState body="Nobody has entered yet." />
          ) : (
            entries.map((entry) => (
              <EntryRow
                canEdit={entriesOpen}
                contest={contest}
                currentEventId={currentEventId}
                entry={entry}
                isMine={myTeamId !== null && entry.squadId === myTeamId}
                isOpen={openRows.isOpen(entry.id)}
                key={entry.id}
                leagueCode={leagueCode}
                onToggle={() => openRows.toggle(entry.id)}
              />
            ))
          )}
        </div>
      </SectionCard>
    </ContestPageFrame>
  );
}

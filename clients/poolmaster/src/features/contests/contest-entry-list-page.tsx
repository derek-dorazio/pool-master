import {
  ContestEntryStatus,
  ContestFormat,
  ContestStatus,
  SelectionType,
  formatDollars,
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
  SectionCard,
  Text,
  Tile,
  cn,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { currentContestEvent, entryEventStatus } from './contest-events';
import { ContestPageFrame } from './contest-header';
import { ContestPagePending } from './contest-page-pending';
import { EntryDetailsPeek } from './entry-details-peek';
import { EntryLineupPicks } from './entry-lineup-picks';
import { contestRosterParticipantNoun } from './contest-sport';
import { lineupSpend, useLineupPickValues, type LineupPickValues } from './use-lineup-pick-values';
import { EntryDetailsToggle } from './entry-details-toggle';
import { useOpenEntryRows } from './use-open-entry-rows';
import { useLandOnEntry, useLinkedEntry } from './use-linked-entry';
import { MineMarker } from './mine-marker';
import { isContestFull } from './my-contest-entry';
import { areContestEntriesOpen } from './contest-status';
import { SELECTION_TYPE_ICONS } from './selection-type-icons';
import { SquaresBoardView } from './squares-board-view';
import { StartEntryButton } from './start-entry-button';
import { contestSchedule } from './use-contest-schedule';
import { useContestEntriesQuery } from './use-contest-entries';
import { useContestLeague } from './use-contest-league';
import { useLiveContestQuery } from './use-contest-query';
import { PickEmEntryPicks } from './pick-em-entry-picks';

const BracketIcon = SELECTION_TYPE_ICONS[SelectionType.BRACKET];

/**
 * Whether an entry row of this contest opens to its picks on the entry list. A lineup's does, and
 * a pick'em entry's opens to the week's games (#1751); survivor, bracket and squares rows are
 * still in design (#1739), so the viewer's own open their pick screen through ✎ instead.
 */
function opensToPicks(contest: Pick<ContestDto, 'contestFormat' | 'selectionType'>) {
  return contest.contestFormat === ContestFormat.ROSTER || contest.selectionType === SelectionType.PICK_EM;
}

/**
 * An entry's own line under its name: submitted, or a draft and how many picks it holds, and in a
 * budget contest what its picks cost of the cap.
 */
function describeOwnEntry(entry: ContestEntryDto, currentEventId: string | undefined, spend: ReturnType<typeof lineupSpend>) {
  const status = entryEventStatus(entry, currentEventId) === ContestEntryStatus.SUBMITTED
    ? 'Submitted'
    : `Draft · ${formatPickCount(entry.picksCount)}`;
  if (!spend) {
    return status;
  }
  return spend.salaryCap === null
    ? `${status} · ${formatDollars(spend.spent)}`
    : `${status} · ${formatDollars(spend.spent)} of ${formatDollars(spend.salaryCap)}`;
}

function formatPickCount(count: number) {
  return count === 1 ? '1 pick' : `${String(count)} picks`;
}

/** The entry's picks in the event the page shows: a multi-event contest's entry holds each event's. */
function picksInEvent(entry: ContestEntryDto, sportEventId: string | undefined) {
  return (entry.participants ?? []).filter((pick) => pick.sportEventId === sportEventId);
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
  lineupValues,
  onToggle,
}: {
  canEdit: boolean;
  contest: ContestDto;
  currentEventId: string | undefined;
  entry: ContestEntryDto;
  isMine: boolean;
  isOpen: boolean;
  leagueCode: string;
  /** What the contest's lineup picks show beside their names, for the viewer's own rows. */
  lineupValues: LineupPickValues | undefined;
  onToggle: () => void;
}) {
  const picks = picksInEvent(entry, currentEventId);
  const entryPath = buildLeagueContestEntryPath(leagueCode, contest.id, entry.id);
  // A bracket's own entries open their bracket from the icon before the name (#1753); the other
  // formats keep ✎ at the row's end.
  const editsFromIcon = isMine && canEdit && contest.selectionType === SelectionType.BRACKET;
  const summary = (
    <div className="flex items-center justify-between gap-3">
      <span className="block min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex items-center">
            {editsFromIcon ? (
              <Button
                aria-label={`Edit bracket: ${entry.name}`}
                asChild
                className="-my-2 mr-1"
                data-testid={`contest-board-edit-entry-${entry.id}`}
                size="xs"
                variant="icon"
              >
                <Link title="Edit bracket" to={entryPath}>
                  <BracketIcon aria-hidden size={16} />
                </Link>
              </Button>
            ) : null}
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
            {describeOwnEntry(entry, currentEventId, lineupSpend(picks, lineupValues))}
          </Text>
        ) : null}
      </span>
      {isMine && canEdit && !editsFromIcon ? (
        <Button
          aria-label={`Edit ${entry.name}`}
          asChild
          data-testid={`contest-board-edit-entry-${entry.id}`}
          size="icon"
          variant="icon"
        >
          <Link title="Edit picks and name" to={entryPath}>
            <Pencil aria-hidden size={16} />
          </Link>
        </Button>
      ) : null}
    </div>
  );

  return (
    <Tile
      className={cn('overflow-clip', isMine ? 'border-primary/40' : undefined)}
      data-entry-id={entry.id}
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
          {contest.selectionType === SelectionType.PICK_EM ? (
            currentEventId ? <PickEmEntryPicks contest={contest} entryId={entry.id} sportEventId={currentEventId} /> : null
          ) : (
            <EntryLineupPicks entryId={entry.id} noun={contestRosterParticipantNoun(contest)} picks={picks} values={lineupValues} />
          )}
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
 * once the contest is full a notice stands there instead. A link naming one of the viewer's own
 * entries (`?entry=`, #1762) opens it and scrolls to it; another team's id does nothing, since
 * their picks are hidden until the contest locks.
 */
export function ContestEntryListPage() {
  const logger = getLogger().child({ feature: 'contest-page' });
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
  const linkedEntry = useLinkedEntry();
  const landOn = useLandOnEntry();
  // Each event takes its own submitted picks (#713): an entry's status is the current event's.
  const currentEventId = contestQuery.data ? currentContestEvent(contestQuery.data)?.sportEventId : undefined;
  const lineupValues = useLineupPickValues(
    contestQuery.data?.selectionType,
    currentEventId ?? '',
    contestQuery.data !== undefined && opensToPicks(contestQuery.data) && myEntryIds.length > 0,
  );

  useEffect(() => {
    if (contestQuery.isError) {
      logger.warn(
        { action: 'contestPage.contest.failed', data: { contestId, leagueCode }, err: contestQuery.error },
        'Contest page failed to load contest data',
      );
    }
  }, [contestId, contestQuery.error, contestQuery.isError, leagueCode, logger]);

  if (!contestQuery.data) {
    return <ContestPagePending isError={contestQuery.isError} onRetry={() => void contestQuery.refetch()} />;
  }

  const contest = contestQuery.data;
  const schedule = contestSchedule(contest);
  const entries = contestEntriesQuery.data?.entries ?? [];
  const entriesOpen = areContestEntriesOpen(contest, schedule?.startsAt);
  // The cap counts every team's drafts too: its plan's (#947), or its expansion (#987).
  const entryCount = contest.allEntryCount ?? entries.length;
  const entryCap = contest.entriesPerContest;
  const isFull = isContestFull(contest, entryCount);
  const canCreateEntry = entriesOpen && Boolean(myTeamId) && !isFull;
  const hasMine = myEntryIds.length > 0;
  const expandableIds = opensToPicks(contest) ? myEntryIds : [];
  const linkedMineId = myEntryIds.find((entryId) => entryId === linkedEntry.entryId) ?? null;
  // A squares board lands on its own linked entry once its boxes load.
  landOn(contest.selectionType === SelectionType.SQUARES ? null : linkedMineId, () => {
    if (linkedMineId !== null && expandableIds.includes(linkedMineId)) {
      openRows.open(linkedMineId);
    }
  });
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
      headerTestId="contest-page-header"
      leagueCode={leagueCode}
      summary={(
        <>
          <span className="inline-flex items-center" data-testid="contest-page-summary">
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
            <span data-testid="contest-page-schedule">
              <span data-testid="contest-page-starts">
                Starts <DateDisplay tone="inherit" value={schedule.startsAt} />
              </span>
              {schedule.endsAt ? (
                <span data-testid="contest-page-ends">
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

      {/* A squares contest's board is its entry list (#1758): every entry is on it by its boxes. */}
      {contest.selectionType === SelectionType.SQUARES ? (
        <SquaresBoardView
          canManage={viewer.isCommissioner || viewer.isRootAdmin}
          contest={contest}
          // Before lock a member's link opens only their own entry; a commissioner's opens any
          // entry, which they then claim boxes for.
          linkedEntryId={viewer.isCommissioner || viewer.isRootAdmin ? linkedEntry.entryId : linkedMineId}
          myEntryIds={contest.myEntryIds ?? []}
        />
      ) : (
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
                lineupValues={lineupValues}
                onToggle={() => {
                  // Closing the linked entry drops it from the address, so a reload doesn't open it again.
                  if (entry.id === linkedMineId && openRows.isOpen(entry.id)) {
                    linkedEntry.clear();
                  }
                  openRows.toggle(entry.id);
                }}
              />
            ))
          )}
        </div>
      </SectionCard>
      )}
    </ContestPageFrame>
  );
}

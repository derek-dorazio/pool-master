import { Trophy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import type { ContestDto } from '@/lib/api';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  DetailsPeek,
  ExpandableRow,
  Input,
  PeekCard,
  LoadingState,
  PendingPage,
  Pager,
  Switch,
  Text,
  Tile,
  cn,
  formatDateTimeDisplay,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { QueryKeys } from '@/lib/query-keys';
import {
  buildLeaderboardView,
  type LeaderboardEntryRow,
  type LeaderboardPickRow,
  type LeaderboardView,
} from './contest-leaderboard';
import { ContestStatus, ScoringFamily, SelectionType, SportEventStatus, eventSportDefinition } from '@poolmaster/shared/domain';
import { BracketLeaderboard } from './bracket-leaderboard';
import { PickEmLeaderboard } from './pick-em-leaderboard';
import { SquaresLeaderboard } from './squares-pages';
import { SurvivorLeaderboard } from './survivor-leaderboard';
import { useContestLeaderboardQuery } from './use-contest-leaderboard';
import { useContestLeague } from './use-contest-league';
import { useLiveContestQuery } from './use-contest-query';
import { LEADERBOARD_PAGE_SIZE, isMySquadsEntry } from './leaderboard-columns';
import { LeaderboardFrame, LeaderboardSection } from './leaderboard-kit';
import { EntryDetailsPeek } from './entry-details-peek';
import { MineMarker } from './mine-marker';
import { MyEntriesToggle } from './my-entries-toggle';
import { narrowToMyEntries, useMyEntriesFilter } from './use-my-entries-filter';
import { EntryDetailsToggle } from './entry-details-toggle';
import { useOpenEntryRows } from './use-open-entry-rows';
import { useLandOnEntry, useLinkedEntry } from './use-linked-entry';
import { useLeaderboardFallback } from './use-leaderboard-fallback';
import { ContestEventSwitcher } from './contest-event-switcher';
import { hasContestEventStarted } from './contest-events';
import { upperFirst } from '@/lib/upper-first';
import { useEventRoundName } from './use-bracket-round-label';
import { sportEventQueryOptions } from './use-contest-schedule';
import { useLeaderboardEventGames } from './use-event-games';

/**
 * The member-facing contest leaderboard (#110, #111, #112).
 *
 * A contest's page once it is live or final (#1739); before then the same address lists its
 * entries (`ContestEntryListPage`). Nothing about how an
 * entry was drafted appears here — no tier, price, rank, odds or category — which is what
 * makes the view format-agnostic: a tiered pool and a budget pool render identically,
 * because "N golfers, M counting" is all a leaderboard is about. The columns after the total are
 * the scoring family's (`SCORING_FAMILY_UI`), and every word for a participant or a round is the
 * sport definition's.
 *
 * Once the contest is COMPLETED the same endpoint serves the standings frozen at settlement,
 * so there is no separate final mode to render. A bracket contest's board is its own
 * (`BracketLeaderboard`, #721), and so are a pick'em contest's season board (`PickEmLeaderboard`,
 * #718), a survivor contest's (`SurvivorLeaderboard`, #719) and a squares contest's grid
 * (`SquaresLeaderboard`, #711): an entry there is its picks of games or its boxes, not a lineup.
 */

/** The leaderboard read a contest's board shows: a bracket's, a pick'em's and a survivor's are their own. */
function leaderboardKeyFor(contestId: string, selectionType: SelectionType) {
  switch (selectionType) {
    case SelectionType.BRACKET:
      return QueryKeys.contests.bracketLeaderboard(contestId);
    case SelectionType.PICK_EM:
      return QueryKeys.contests.pickEmLeaderboard(contestId);
    case SelectionType.SURVIVOR:
      return QueryKeys.contests.survivorLeaderboard(contestId);
    case SelectionType.SQUARES:
      return QueryKeys.contests.squaresBoard(contestId);
    case SelectionType.TIERED:
    case SelectionType.BUDGET_PICK:
    case SelectionType.RANDOM_DRAW:
      return QueryKeys.contests.leaderboard(contestId);
  }
}

/** An unscored cell. A participant with nothing posted is not a zero. */
const NO_SCORE = '—';

/** Whether an entry matches the "Find an entry" box: its entry name or its squad's name. */
function matchesSearch(entry: LeaderboardEntryRow, search: string) {
  const needle = search.trim().toLowerCase();
  return !needle
    || entry.entryName.toLowerCase().includes(needle)
    || entry.squadName.toLowerCase().includes(needle);
}

/**
 * Position, name and total take fixed tracks (the name takes the slack); the family's columns
 * follow. Every track keeps a real minimum, the name's too: where the row is narrower than the
 * minimums (a phone, a stat pool with five games), the board scrolls sideways instead of
 * squeezing the name to nothing.
 */
function leaderboardGridColumns(view: LeaderboardView) {
  return [
    // Pos's minimum is the board's --pos-width, which the pinned name column also reads.
    'minmax(var(--pos-width),0.3fr)',
    'minmax(6rem,1.5fr)',
    'minmax(48px,0.4fr)',
    ...view.detailColumns.map((column) => column.width),
  ].join(' ');
}

/*
 * On a phone the board scrolls sideways (#1627), so a few parts stay put while the columns move.
 * The board is a size container, so `100cqw` is its visible width; an entry's tile has a 1px
 * border on each side.
 */
/** An entry's bar and a pick's breakdown: pinned to the left, as wide as the visible board. */
const VISIBLE_WIDTH = 'sticky left-0 w-[calc(100cqw-2px)]';
/** The Pos column: pinned to the left, its background reaching back over the row's padding. */
const PINNED_POSITION = 'sticky left-0 z-[1] -ml-4 pl-4';
/** The name column: pinned just right of Pos (the row's 16px padding, Pos's width, an 8px gap). */
const PINNED_NAME = 'sticky left-[calc(var(--pos-width)+24px)] z-[1] -mr-2 pr-2';
/** Pos's width while the board scrolls, set once on the board for its grid and the pinned name. */
const POS_WIDTH = '[--pos-width:36px]';
/** A pinned cell is opaque so the columns slide under it, and takes the row's hover tint on top. */
const PINNED_CELL_SURFACE =
  'bg-background group-hover/pick:[background-image:linear-gradient(var(--table-row-hover-surface),var(--table-row-hover-surface))]';

/**
 * One participant under an entry. Where the family's cells are made of stats (a stat pool
 * player's games), the entry's Stats switch adds a line of them under the name (#1747), and each
 * game's score opens that game's stats in a popover.
 */
function PickRow({
  entryId,
  gridTemplateColumns,
  pick,
  showStats,
}: {
  entryId: string;
  gridTemplateColumns: string;
  pick: LeaderboardPickRow;
  showStats: boolean;
}) {
  // #1740 — a pick outside the best N: listed, struck through and in italics, out of the total.
  const isDroppedClass = pick.isDropped ? 'italic text-muted-foreground line-through' : 'text-foreground';
  const testId = `contest-leaderboard-pick-${entryId}-${pick.pickId}`;
  return (
    <div className="group/pick px-4 py-2 transition hover:bg-row-hover" data-testid={testId}>
      <div className="grid items-start gap-2 text-sm" style={{ gridTemplateColumns }}>
        <span className={cn(PINNED_POSITION, PINNED_CELL_SURFACE, 'text-muted-foreground')} data-testid={`${testId}-position`}>{pick.position ?? NO_SCORE}</span>
        {/* The worst M - N picks: visibly present, visibly excluded from the total. */}
        <span className={cn(PINNED_NAME, PINNED_CELL_SURFACE, 'min-w-0', isDroppedClass)} data-dropped={pick.isDropped || undefined} data-testid={`${testId}-name`}>
          <span className="block truncate">{pick.participantName}</span>
          {showStats && pick.statLine ? (
            // Inside the name's cell, a dropped pick's line is struck through and italic with it.
            <Text as="span" className="block" data-testid={`${testId}-stats`} size="xs" tone="muted" variant="meta">
              {pick.statLine}
            </Text>
          ) : null}
        </span>
        <span className={cn('text-right font-medium', isDroppedClass)}>
          {pick.total ?? NO_SCORE}
        </span>
        {pick.detailCells.map((cell) => (
          // #478 — a cell the participant did not play counts at a fixed value; set apart
          // so the total is explainable, and named for a screen reader.
          <span
            aria-label={cell.unplayed?.ariaLabel}
            className={cn('text-right text-muted-foreground', cell.unplayed && 'italic')}
            data-testid={cell.testId}
            data-unplayed={cell.unplayed ? true : undefined}
            key={cell.key}
          >
            {cell.peek ? (
              <DetailsPeek
                icon={cell.text ?? NO_SCORE}
                label={`${cell.peek.title} stats`}
                testId={`${cell.testId}-peek`}
                trigger="text"
              >
                <PeekCard facts={cell.peek.facts} title={cell.peek.title} />
              </DetailsPeek>
            ) : cell.chip && cell.text ? (
              <Chip className="whitespace-nowrap px-2 py-0.5" tone={cell.chip}>{cell.text}</Chip>
            ) : (cell.text ?? NO_SCORE)}
          </span>
        ))}
      </div>
    </div>
  );
}

function EntryBlock({
  entry,
  contestEvents,
  gridTemplateColumns,
  isCollapsed,
  isMine,
  league,
  onStatsChange,
  onToggle,
  showStats,
}: {
  entry: LeaderboardEntryRow;
  /** The contest's league, for the entry's (i) peek at its team. */
  league: { code: string; id: string };
  /** The contest's events by id when it covers several, for the per-event line; else null. */
  contestEvents: ReadonlyMap<string, ContestDto['sportEvents'][number]> | null;
  gridTemplateColumns: string;
  isCollapsed: boolean;
  isMine: boolean;
  /** Flips the entry's Stats switch; absent on a board whose picks have no stat lines. */
  onStatsChange: ((on: boolean) => void) | null;
  onToggle: () => void;
  /** Whether the entry's Stats switch is on: each pick's stat line shows under its name. */
  showStats: boolean;
}) {
  const picks = entry.picks.length === 0 ? (
    <p className="px-4 py-3 text-sm text-muted-foreground">
      This entry has no scored picks yet.
    </p>
  ) : (
    <div className="divide-y divide-border">
      {entry.picks.map((pick) => (
        <PickRow entryId={entry.entryId} gridTemplateColumns={gridTemplateColumns} key={pick.pickId} pick={pick} showStats={showStats} />
      ))}
    </div>
  );
  return (
    <Tile
      // `clip`, not `hidden`: a hidden overflow would make the tile the scroll box its pinned parts stick to.
      className={cn('overflow-clip', isMine ? 'border-primary/40' : undefined)}
      data-entry-id={entry.entryId}
      data-mine={isMine || undefined}
      data-testid={`contest-leaderboard-entry-${entry.entryId}`}
      padding="none"
      variant="subtle"
    >
      {/* #389: the grey entry bar opens and closes its own participant rows; the entry's (i) (#1564) sits above it. */}
      <ExpandableRow
        isOpen={!isCollapsed}
        label={`Picks for ${entry.entryName}`}
        look="bar"
        rowClassName={VISIBLE_WIDTH}
        rowTestId={`contest-leaderboard-entry-bar-${entry.entryId}`}
        onToggle={onToggle}
        summary={
          // One line on a phone too: the name side wraps within itself, the switch and total stay put.
          <div className="flex items-center justify-between gap-3">
            <span className="block min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="text-sm font-semibold text-muted-foreground"
                  data-testid={`contest-leaderboard-position-${entry.entryId}`}
                >
                  {entry.displayPosition ?? NO_SCORE}
                </span>
                <span className="flex items-center">
                  <span className="font-medium text-foreground">{entry.entryName}</span>
                  <EntryDetailsPeek
                    className="-my-2"
                    entryName={entry.entryName}
                    leagueCode={league.code}
                    leagueId={league.id}
                    squadId={entry.squadId}
                    testId={`contest-leaderboard-entry-peek-${entry.entryId}`}
                  />
                </span>
                {isMine ? <MineMarker /> : null}
              </span>
              {contestEvents && entry.events.length > 0 ? (
                <span className="mt-1 block text-xs text-muted-foreground" data-testid={`contest-leaderboard-events-${entry.entryId}`}>
                  {entry.events.map((event, index) => (
                    <span key={event.sportEventId}>
                      {index > 0 ? ' · ' : null}
                      {`${contestEvents.get(event.sportEventId)?.name ?? 'Event'}: ${event.displayPosition ?? NO_SCORE}, ${event.total ?? NO_SCORE}`}
                      {/* A final event's first place won it (#714): each major has its own winner. */}
                      {event.position === 1 && contestEvents.get(event.sportEventId)?.status === SportEventStatus.COMPLETED ? (
                        <Trophy
                          aria-label="Event winner"
                          className="ml-1 inline text-primary"
                          data-testid={`contest-leaderboard-event-winner-${event.sportEventId}-${entry.entryId}`}
                          size={12}
                        />
                      ) : null}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <span className="flex flex-none items-center gap-3">
              {onStatsChange ? (
                // #1747 — one switch per entry turns on every pick's stat line at once.
                <span className="flex items-center gap-2">
                  <Switch
                    checked={showStats}
                    label={`Stats for ${entry.entryName}`}
                    onCheckedChange={onStatsChange}
                    testId={`contest-leaderboard-stats-${entry.entryId}`}
                  />
                  <Text aria-hidden as="span" className="hidden sm:inline" size="xs" variant="label">Stats</Text>
                </span>
              ) : null}
              <span
                className="score-total text-foreground"
                data-testid={`contest-leaderboard-total-${entry.entryId}`}
              >
                {entry.total ?? NO_SCORE}
              </span>
            </span>
          </div>
        }
        toggleTestId={`contest-leaderboard-entry-toggle-${entry.entryId}`}
      >
        {picks}
      </ExpandableRow>
    </Tile>
  );
}

export function ContestLeaderboardPage() {
  const displayPreferences = useDisplayPreferences();
  const { contestId = '' } = useParams<{ contestId: string }>();

  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const myEntriesFilter = useMyEntriesFilter();
  // #1762 — an entry a link names (`?entry=`) opens on its page and scrolls into view.
  const linkedEntry = useLinkedEntry();
  const landOn = useLandOnEntry();
  // Which event's picks the board shows (#713); null is the server's choice, its latest revealed.
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);

  const contestQuery = useLiveContestQuery(contestId, (contest) => leaderboardKeyFor(contestId, contest.selectionType));

  // #112 — the same cadence the contest board polls entries on, driven by the same predicate.
  // The contest read above refreshes until settlement (#362), so this starts when play starts and
  // stops when the contest settles, and each status change it sees reads the leaderboard once
  // more, which is how the final standings land.
  // A bracket (#721), a pick'em contest (#718) and a survivor contest (#719) have their own boards; the roster board waits
  // for the contest to say which it is, since it refuses a prediction contest.
  const selectionType = contestQuery.data?.selectionType;
  const isBracket = selectionType === SelectionType.BRACKET;
  const isPickEm = selectionType === SelectionType.PICK_EM;
  const isSurvivor = selectionType === SelectionType.SURVIVOR;
  const isSquares = selectionType === SelectionType.SQUARES;
  const leaderboardQuery = useContestLeaderboardQuery(contestId, contestQuery.data?.status, {
    enabled: contestQuery.data !== undefined && !isBracket && !isPickEm && !isSurvivor && !isSquares,
    sportEventId: requestedEventId,
  });
  const { leagueCode, viewer } = useContestLeague(contestQuery.data?.leagueId);
  // #389, #1739 — the viewer's own entries start open and everyone else's closed.
  const mySquadId = viewer.mySquadId;
  const myEntryIds = leaderboardQuery.data?.entries
    .filter((entry) => mySquadId !== null && entry.squadId === mySquadId)
    .map((entry) => entry.entryId) ?? [];
  const openRows = useOpenEntryRows(myEntryIds);
  // #1747 — which entries show their picks' stat lines: the viewer's own start on, as they start open.
  const statsRows = useOpenEntryRows(myEntryIds);
  // #1748 — a team-picks board describes each team's games, read from the shown event's bracket.
  const shownEventId = leaderboardQuery.data?.sportEventId ?? '';
  const isTeamPicks = leaderboardQuery.data !== undefined
    && eventSportDefinition(leaderboardQuery.data).scoringFamily === ScoringFamily.HEAD_TO_HEAD;
  const gamesQuery = useLeaderboardEventGames(shownEventId, contestQuery.data?.status, isTeamPicks);
  const shownEventQuery = useQuery({ ...sportEventQueryOptions(shownEventId), enabled: isTeamPicks && shownEventId !== '' });
  const roundName = useEventRoundName(shownEventQuery.data ?? null);
  const leaderboardFallback = useLeaderboardFallback(leaderboardQuery, { action: 'contestLeaderboard.load.failed', contestId });

  if (contestQuery.isLoading) {
    return <PendingPage testId="contest-leaderboard-pending"><LoadingState body="Loading contest leaderboard..." /></PendingPage>;
  }

  if (contestQuery.data && isBracket) {
    return <BracketLeaderboard contest={contestQuery.data} />;
  }
  if (contestQuery.data && isPickEm) {
    return <PickEmLeaderboard contest={contestQuery.data} />;
  }
  if (contestQuery.data && isSurvivor) {
    return <SurvivorLeaderboard contest={contestQuery.data} />;
  }
  if (contestQuery.data && isSquares) {
    return <SquaresLeaderboard contest={contestQuery.data} />;
  }

  if (contestQuery.isError || !contestQuery.data) {
    return (
      <PendingPage testId="contest-leaderboard-pending">
        <ErrorState
          body="We couldn't load this contest."
          onRetry={() => void contestQuery.refetch()}
        />
      </PendingPage>
    );
  }

  if (leaderboardFallback || !leaderboardQuery.data) {
    return leaderboardFallback;
  }

  const contest = contestQuery.data;
  // Until its games load (or if their read fails) a team-picks board shows what the leaderboard says alone.
  const view = buildLeaderboardView(leaderboardQuery.data, gamesQuery.data ? {
    games: gamesQuery.data,
    roundName,
    formatStart: (startsAt) => formatDateTimeDisplay(startsAt, displayPreferences),
  } : undefined, { isLive: contestQuery.data.status === ContestStatus.ACTIVE });
  const participantNoun = eventSportDefinition(leaderboardQuery.data).vocabulary.participant;
  const gridTemplateColumns = leaderboardGridColumns(view);
  const hasStatLines = view.entries.some((entry) => entry.picks.some((pick) => pick.statLine));
  const isMultiEvent = contest.sportEvents.length > 1;
  const contestEvents = isMultiEvent
    ? new Map(contest.sportEvents.map((sportEvent) => [sportEvent.sportEventId, sportEvent]))
    : null;
  // An event's picks are on the board once it has started (or the contest is final).
  const revealedEvents = contest.sportEvents.filter((sportEvent) => (
    contest.status === ContestStatus.COMPLETED || hasContestEventStarted(sportEvent)
  ));

  // #1740 — the counting rule shows once, in the header, rather than on every entry's bar. M is
  // what a full entry holds under the contest's rules, so a short entry cannot shrink it; where
  // the server cannot know M yet, the header says nothing rather than guess.
  const { count: countedPicks, pickCount } = leaderboardQuery.data.countingRule;
  const countingRule = pickCount !== null && countedPicks < pickCount
    ? `Best ${String(countedPicks)} of ${String(pickCount)} ${participantNoun.many} count`
    : null;

  const allEntryIds = view.entries.map((entry) => entry.entryId);
  const openEntryIds = allEntryIds.filter(openRows.isOpen);
  // #1750 — "My entries" narrows the board to the viewer's own, each at its real place; search and
  // paging then work within them.
  const myEntries = narrowToMyEntries(view.entries, isMySquadsEntry(mySquadId), myEntriesFilter.isOn);
  const matchingEntries = myEntries.rows.filter((entry) => matchesSearch(entry, search));
  const pageCount = Math.max(1, Math.ceil(matchingEntries.length / LEADERBOARD_PAGE_SIZE));
  // A refetch or a narrower search can leave fewer pages than the one being shown.
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const linkedIndex = matchingEntries.findIndex((entry) => entry.entryId === linkedEntry.entryId);
  landOn(linkedIndex >= 0 ? linkedEntry.entryId : null, () => {
    openRows.open(matchingEntries[linkedIndex].entryId);
    setPageIndex(Math.floor(linkedIndex / LEADERBOARD_PAGE_SIZE));
  });
  const pageEntries = matchingEntries.slice(
    currentPage * LEADERBOARD_PAGE_SIZE,
    (currentPage + 1) * LEADERBOARD_PAGE_SIZE,
  );

  return (
    <LeaderboardFrame
      contest={contest}
      isUnscored={view.isUnscored}
      finalRows={view.entries.map((entry) => ({
        entryName: entry.entryName,
        isMine: isMySquadsEntry(mySquadId)(entry),
        position: entry.position ?? null,
        score: entry.total ?? '',
      }))}
      leagueCode={leagueCode}
      notes={view.currentRoundLabel ? (
        <Chip data-testid="contest-leaderboard-round-cue" tone="info">
          {view.currentRoundLabel}
        </Chip>
      ) : null}
      summary={countingRule ? <span data-testid="contest-leaderboard-counting-rule">{countingRule}</span> : undefined}
      // #246 — an entry's standing is frozen at settlement while each participant's own score
      // stays live, so a late correction can make the two disagree on this very page. Say so
      // rather than let it read as a bug.
      settledNote={`Final result, settled ${formatDateTimeDisplay(contest.endsAt, displayPreferences, 'at the end of the event')}. Entry standings are frozen at settlement; each pick's score shows current event data and can differ after a late score correction.`}
    >
      <ContestEventSwitcher
        events={revealedEvents}
        onChange={(sportEventId) => {
          setRequestedEventId(sportEventId);
          setPageIndex(0);
        }}
        testId="contest-leaderboard-event-switcher"
        value={leaderboardQuery.data.sportEventId}
      />

      <LeaderboardSection>
        {view.entries.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                aria-label="Find an entry"
                className="max-w-xs"
                data-testid="contest-leaderboard-search"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPageIndex(0);
                }}
                placeholder="Find an entry"
                type="search"
                value={search}
              />
              {myEntries.hasMine ? (
                <MyEntriesToggle
                  checked={myEntries.showsMineOnly}
                  onCheckedChange={(on) => {
                    myEntriesFilter.setOn(on);
                    setPageIndex(0);
                  }}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {hasStatLines ? (
                // #1747 — every opened entry's Stats switch at once; with every one on, it turns them off.
                <Button
                  data-testid="contest-leaderboard-toggle-all-stats"
                  disabled={openEntryIds.length === 0}
                  onClick={() => statsRows.setAll(openEntryIds, !statsRows.allOpen(openEntryIds))}
                  size="sm"
                  variant="secondary"
                >
                  {statsRows.allOpen(openEntryIds) ? 'Hide all stats' : 'Show all stats'}
                </Button>
              ) : null}
              <EntryDetailsToggle
                allOpen={openRows.allOpen(allEntryIds)}
                onToggle={(open) => openRows.setAll(allEntryIds, open)}
                testId="contest-leaderboard-toggle-all"
              />
            </div>
          </div>
        ) : null}
        {/*
          The column heads and the entries scroll sideways together, inside the board, when the
          columns' minimum widths are wider than the screen; the page itself never widens.
        */}
        <div className={cn('overflow-x-auto [container-type:inline-size]', POS_WIDTH)} data-testid="contest-leaderboard-board">
          <div className="min-w-min" data-testid="contest-leaderboard-board-content">
            <div
              className="grid gap-2 rounded-lg bg-surface-inverse px-4 py-2 text-xs font-medium uppercase text-primary"
              data-testid="contest-leaderboard-column-headers"
              style={{ gridTemplateColumns }}
            >
              <span className={cn(PINNED_POSITION, 'rounded-l-lg bg-surface-inverse')}>Pos</span>
              <span className={cn(PINNED_NAME, 'bg-surface-inverse')}>{upperFirst(participantNoun.one)}</span>
              <span className="text-right">Tot</span>
              {view.detailColumns.map((column) => (
                <span className="flex flex-col items-end gap-1 text-right" data-testid={column.testId} key={column.key}>
                  {column.label}
                  {column.isLive ? (
                    <Chip className="px-1.5 py-0" data-testid={`${column.testId ?? column.key}-live`} tone="live">Live</Chip>
                  ) : null}
                </span>
              ))}
            </div>

            <div className="space-y-3" data-testid="contest-leaderboard-entries">
              {view.entries.length === 0 ? (
                <EmptyState body="No entries." />
              ) : matchingEntries.length === 0 ? (
                <EmptyState body="No entry matches that name." testId="contest-leaderboard-no-match" />
              ) : (
                pageEntries.map((entry) => (
                  <EntryBlock
                    entry={entry}
                    contestEvents={contestEvents}
                    gridTemplateColumns={gridTemplateColumns}
                    isCollapsed={!openRows.isOpen(entry.entryId)}
                    isMine={isMySquadsEntry(mySquadId)(entry)}
                    key={entry.entryId}
                    league={{ code: leagueCode, id: contest.leagueId }}
                    onStatsChange={hasStatLines ? (on) => {
                      // Turning stats on for a closed entry opens it, so the stats show.
                      statsRows.setAll([entry.entryId], on);
                      if (on) {
                        openRows.open(entry.entryId);
                      }
                    } : null}
                    onToggle={() => {
                      // Closing the linked entry drops it from the address, so a reload doesn't open it again.
                      if (entry.entryId === linkedEntry.entryId && openRows.isOpen(entry.entryId)) {
                        linkedEntry.clear();
                      }
                      openRows.toggle(entry.entryId);
                    }}
                    showStats={statsRows.isOpen(entry.entryId)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
        <div>
          <Pager
            onNext={() => setPageIndex(currentPage + 1)}
            onPrevious={() => setPageIndex(currentPage - 1)}
            pageCount={pageCount}
            pageIndex={currentPage}
            pageSize={LEADERBOARD_PAGE_SIZE}
            total={matchingEntries.length}
          />
        </div>
        {view.footnote ? (
          <p className="text-xs text-muted-foreground" data-testid={view.footnote.testId}>
            {view.footnote.text}
          </p>
        ) : null}
      </LeaderboardSection>
    </LeaderboardFrame>
  );
}

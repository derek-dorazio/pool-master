import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useParams } from 'react-router';
import type { ContestDto } from '@/lib/api';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ExpandableRow,
  FactList,
  Input,
  LoadingState,
  Pager,
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
import { ContestStatus, SelectionType, SportEventStatus, eventSportDefinition } from '@poolmaster/shared/domain';
import { BracketLeaderboard } from './bracket-leaderboard';
import { PickEmLeaderboard } from './pick-em-leaderboard';
import { SquaresLeaderboard } from './squares-pages';
import { SurvivorLeaderboard } from './survivor-leaderboard';
import { useContestLeaderboardQuery } from './use-contest-leaderboard';
import { useContestLeague } from './use-contest-league';
import { useLiveContestQuery } from './use-contest-query';
import { LEADERBOARD_PAGE_SIZE, isMySquadsEntry } from './leaderboard-columns';
import { LeaderboardFrame } from './leaderboard-kit';
import { EntryDetailsPeek } from './entry-details-peek';
import { MineMarker } from './mine-marker';
import { useLeaderboardFallback } from './use-leaderboard-fallback';
import { ContestEventSwitcher } from './contest-event-switcher';
import { hasContestEventStarted } from './contest-events';
import { upperFirst } from '@/lib/upper-first';

/**
 * The member-facing contest leaderboard (#110, #111, #112).
 *
 * Its own route, deliberately not folded into the contest board: that page is entry and
 * update, pre-live, and this one is live and post-settlement results. Nothing about how an
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

function entryBlockId(entryId: string) {
  return `contest-leaderboard-entry-${entryId}`;
}

/** Whether an entry matches the "Find an entry" box: its entry name or its squad's name. */
function matchesSearch(entry: LeaderboardEntryRow, search: string) {
  const needle = search.trim().toLowerCase();
  return !needle
    || entry.entryName.toLowerCase().includes(needle)
    || entry.squadName.toLowerCase().includes(needle);
}

/** Position, name and total take fixed tracks (the name takes the slack); the family's columns follow. */
function leaderboardGridColumns(view: LeaderboardView) {
  return [
    'minmax(36px,0.3fr)',
    'minmax(0,1.5fr)',
    'minmax(48px,0.4fr)',
    ...view.detailColumns.map((column) => column.width),
  ].join(' ');
}

/**
 * One participant under an entry. Where the family breaks a score into parts (a stat pool
 * player's games), the row is an `ExpandableRow` that opens them beneath it.
 */
function PickRow({ entryId, gridTemplateColumns, pick }: { entryId: string; gridTemplateColumns: string; pick: LeaderboardPickRow }) {
  const { breakdown } = pick;
  const isDroppedClass = pick.isDropped ? 'text-muted-foreground line-through' : 'text-foreground';
  const cells = (
    <div className="grid gap-2 text-sm" style={{ gridTemplateColumns }}>
      <span className="text-muted-foreground">{pick.position ?? NO_SCORE}</span>
      {/* The worst M - N picks: visibly present, visibly excluded from the total. */}
      <span className={cn('min-w-0 truncate', isDroppedClass)}>{pick.participantName}</span>
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
          {cell.text ?? NO_SCORE}
        </span>
      ))}
    </div>
  );
  const testId = `contest-leaderboard-pick-${entryId}-${pick.pickId}`;
  if (!breakdown) {
    return <div className="px-4 py-2" data-testid={testId}>{cells}</div>;
  }
  return (
    <div data-testid={testId}>
      <ExpandableRow label={`Game by game for ${pick.participantName}`} summary={cells} toggleTestId={`${breakdown.testId}-toggle`}>
        <FactList
          density="compact"
          facts={breakdown.lines.map((line) => ({ id: line.key, label: line.label, value: line.text }))}
          layout="inset"
          testId={breakdown.testId}
        />
      </ExpandableRow>
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
  onToggle,
}: {
  entry: LeaderboardEntryRow;
  /** The contest's league, for the entry's (i) peek at its team. */
  league: { code: string; id: string };
  /** The contest's events by id when it covers several, for the per-event line; else null. */
  contestEvents: ReadonlyMap<string, ContestDto['sportEvents'][number]> | null;
  gridTemplateColumns: string;
  isCollapsed: boolean;
  isMine: boolean;
  onToggle: () => void;
}) {
  const picks = entry.picks.length === 0 ? (
    <p className="px-4 py-3 text-sm text-muted-foreground">
      This entry has no scored picks yet.
    </p>
  ) : (
    <div className="divide-y divide-border">
      {entry.picks.map((pick) => (
        <PickRow entryId={entry.entryId} gridTemplateColumns={gridTemplateColumns} key={pick.pickId} pick={pick} />
      ))}
    </div>
  );
  return (
    <Tile
      className={cn('overflow-hidden', isMine ? 'border-primary/40' : undefined)}
      data-mine={isMine || undefined}
      data-testid={`contest-leaderboard-entry-${entry.entryId}`}
      id={entryBlockId(entry.entryId)}
      padding="none"
      radius="lg"
      variant="subtle"
    >
      {/* #389: the grey entry bar opens and closes its own participant rows; the entry's (i) (#1564) sits above it. */}
      <ExpandableRow
        isOpen={!isCollapsed}
        label={`Picks for ${entry.entryName}`}
        look="bar"
        onToggle={onToggle}
        summary={
          <div className="flex flex-wrap items-baseline justify-between gap-3">
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
              <span className="mt-1 block text-xs text-muted-foreground">
                best {entry.countingPickLimit} of {entry.picks.length} count · {entry.scoredPickCount} scored
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
            <span
              className="score-total text-foreground"
              data-testid={`contest-leaderboard-total-${entry.entryId}`}
            >
              {entry.total ?? NO_SCORE}
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

  // #389 — which entries' participant rows are hidden. Keyed by entry id so it survives the live
  // polls; an entry that first appears mid-session starts expanded like every other.
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<ReadonlySet<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
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
  const leaderboardFallback = useLeaderboardFallback(leaderboardQuery, { action: 'contestLeaderboard.load.failed', contestId });

  if (contestQuery.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
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
      <ErrorState
        body="We couldn't load this contest."
        onRetry={() => void contestQuery.refetch()}
      />
    );
  }

  if (leaderboardFallback || !leaderboardQuery.data) {
    return leaderboardFallback;
  }

  const contest = contestQuery.data;
  const view = buildLeaderboardView(leaderboardQuery.data);
  const participantNoun = eventSportDefinition(leaderboardQuery.data).vocabulary.participant;
  const gridTemplateColumns = leaderboardGridColumns(view);
  const hasPickBreakdowns = view.entries.some((entry) => entry.picks.some((pick) => pick.breakdown));
  const isMultiEvent = contest.sportEvents.length > 1;
  const contestEvents = isMultiEvent
    ? new Map(contest.sportEvents.map((sportEvent) => [sportEvent.sportEventId, sportEvent]))
    : null;
  // An event's picks are on the board once it has started (or the contest is final).
  const revealedEvents = contest.sportEvents.filter((sportEvent) => (
    contest.status === ContestStatus.COMPLETED || hasContestEventStarted(sportEvent)
  ));

  const allCollapsed = view.entries.length > 0
    && view.entries.every((entry) => collapsedEntryIds.has(entry.entryId));
  const toggleEntry = (entryId: string) => {
    setCollapsedEntryIds((current) => {
      const next = new Set(current);
      if (!next.delete(entryId)) {
        next.add(entryId);
      }
      return next;
    });
  };
  const toggleAllEntries = () => {
    setCollapsedEntryIds(allCollapsed ? new Set() : new Set(view.entries.map((entry) => entry.entryId)));
  };

  const mySquadId = viewer.mySquadId;
  const matchingEntries = view.entries.filter((entry) => matchesSearch(entry, search));
  const pageCount = Math.max(1, Math.ceil(matchingEntries.length / LEADERBOARD_PAGE_SIZE));
  // A refetch or a narrower search can leave fewer pages than the one being shown.
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageEntries = matchingEntries.slice(
    currentPage * LEADERBOARD_PAGE_SIZE,
    (currentPage + 1) * LEADERBOARD_PAGE_SIZE,
  );
  // The server ranks best first, so the team's first entry is its best placed.
  const myBestIndex = mySquadId === null
    ? -1
    : view.entries.findIndex((entry) => entry.squadId === mySquadId);
  const jumpToMyTeam = () => {
    // at(-1) would be the last entry, so a team with no entry is ruled out first.
    const target = myBestIndex < 0 ? undefined : view.entries.at(myBestIndex);
    if (!target) {
      return;
    }
    // The page holding the entry renders first, so the entry is there to scroll to.
    flushSync(() => {
      setSearch('');
      setPageIndex(Math.floor(myBestIndex / LEADERBOARD_PAGE_SIZE));
      setCollapsedEntryIds((current) => {
        const next = new Set(current);
        next.delete(target.entryId);
        return next;
      });
    });
    document.getElementById(entryBlockId(target.entryId))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      notes={view.currentRoundLabel ? (
        <Chip data-testid="contest-leaderboard-round-cue" tone="info">
          {view.currentRoundLabel}
        </Chip>
      ) : null}
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

      <Tile>
        {view.entries.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
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
              {myBestIndex >= 0 ? (
                <Button
                  data-testid="contest-leaderboard-jump-to-mine"
                  onClick={jumpToMyTeam}
                  size="sm"
                  variant="secondary"
                >
                  Jump to my entry
                </Button>
              ) : null}
            </div>
            <Button
              data-testid="contest-leaderboard-toggle-all"
              onClick={toggleAllEntries}
              size="sm"
              variant="secondary"
            >
              {allCollapsed ? 'Show Details' : 'Hide Details'}
            </Button>
          </div>
        ) : null}
        <div
          // A board whose pick rows open (a stat pool's games) keeps room for their chevron.
          className={cn('grid gap-2 rounded-lg bg-surface-inverse py-2 pl-4 text-xs font-medium uppercase text-primary', hasPickBreakdowns ? 'pr-11' : 'pr-4')}
          data-testid="contest-leaderboard-column-headers"
          style={{ gridTemplateColumns }}
        >
          <span>Pos</span>
          <span>{upperFirst(participantNoun.one)}</span>
          <span className="text-right">Tot</span>
          {view.detailColumns.map((column) => (
            <span className="text-right" data-testid={column.testId} key={column.key}>
              {column.label}
            </span>
          ))}
        </div>

        <div className="space-y-3" data-testid="contest-leaderboard-entries">
          {view.entries.length === 0 ? (
            <EmptyState body="No entries have been scored in this contest yet." />
          ) : matchingEntries.length === 0 ? (
            <EmptyState body="No entry matches that name." testId="contest-leaderboard-no-match" />
          ) : (
            pageEntries.map((entry) => (
              <EntryBlock
                entry={entry}
                contestEvents={contestEvents}
                gridTemplateColumns={gridTemplateColumns}
                isCollapsed={collapsedEntryIds.has(entry.entryId)}
                isMine={isMySquadsEntry(mySquadId)(entry)}
                key={entry.entryId}
                league={{ code: leagueCode, id: contest.leagueId }}
                onToggle={() => toggleEntry(entry.entryId)}
              />
            ))
          )}
        </div>
        <div className="px-4 pt-3">
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
          <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid={view.footnote.testId}>
            {view.footnote.text}
          </p>
        ) : null}
      </Tile>
    </LeaderboardFrame>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import {
  getContest,
  type ContestDto,
} from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { getLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
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
  contestRefetchInterval,
  refreshOnContestStatusChange,
} from './contest-status';
import { ContestHeader, ContestSubMenu } from './contest-header';
import { ContestStatusBadge } from './contest-status-badge';
import {
  LEADERBOARD_ERROR_MESSAGES,
  buildLeaderboardView,
  type LeaderboardEntryRow,
  type LeaderboardPickRow,
  type LeaderboardView,
} from './contest-leaderboard';
import { fetchContestEntries } from './use-contest-entries';
import { ContestStatus, SelectionType, SportEventStatus, eventSportDefinition } from '@poolmaster/shared/domain';
import { BracketLeaderboard } from './bracket-leaderboard';
import { PickEmLeaderboard } from './pick-em-leaderboard';
import { SquaresLeaderboard } from './squares-pages';
import { SurvivorLeaderboard } from './survivor-leaderboard';
import { useContestLeaderboardQuery } from './use-contest-leaderboard';
import { ContestEventSwitcher } from './contest-event-switcher';
import { hasContestEventStarted } from './contest-events';

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

/** Entries per page. A league can have hundreds; one page stays readable on a phone. */
const LEADERBOARD_PAGE_SIZE = 25;

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

/** "golfer" as a column header: "Golfer". */
function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
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
 * player's games), the name opens them beneath the row.
 */
function PickRow({ entryId, gridTemplateColumns, pick }: { entryId: string; gridTemplateColumns: string; pick: LeaderboardPickRow }) {
  const [isOpen, setIsOpen] = useState(false);
  const { breakdown } = pick;
  const nameClassName = cn(
    'min-w-0 truncate',
    // The worst M - N picks: visibly present, visibly excluded from the total.
    pick.isDropped ? 'text-muted-foreground line-through' : 'text-foreground',
  );
  return (
    <div data-testid={`contest-leaderboard-pick-${entryId}-${pick.pickId}`}>
      <div className="grid gap-2 px-4 py-2 text-sm" style={{ gridTemplateColumns }}>
        <span className="text-muted-foreground">{pick.position ?? NO_SCORE}</span>
        {breakdown ? (
          <Button
            aria-controls={breakdown.testId}
            aria-expanded={isOpen}
            className={cn(nameClassName, 'h-auto justify-start p-0 text-left text-sm font-normal underline-offset-2 hover:underline')}
            data-testid={`${breakdown.testId}-toggle`}
            onClick={() => setIsOpen((open) => !open)}
            size="auto"
            variant="ghost"
          >
            {pick.participantName}
          </Button>
        ) : (
          <span className={nameClassName}>{pick.participantName}</span>
        )}
        <span className={cn('text-right font-medium', pick.isDropped ? 'text-muted-foreground line-through' : 'text-foreground')}>
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
            title={cell.unplayed?.title}
          >
            {cell.text ?? NO_SCORE}
          </span>
        ))}
      </div>
      {breakdown && isOpen ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 pb-3 text-xs text-muted-foreground" data-testid={breakdown.testId} id={breakdown.testId}>
          {breakdown.lines.map((line) => (
            <Fragment key={line.key}>
              <dt className="font-medium text-foreground">{line.label}</dt>
              <dd>{line.text}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function EntryBlock({
  entry,
  contestEvents,
  gridTemplateColumns,
  isCollapsed,
  isMine,
  onToggle,
}: {
  entry: LeaderboardEntryRow;
  /** The contest's events by id when it covers several, for the per-event line; else null. */
  contestEvents: ReadonlyMap<string, ContestDto['sportEvents'][number]> | null;
  gridTemplateColumns: string;
  isCollapsed: boolean;
  isMine: boolean;
  onToggle: () => void;
}) {
  const picksId = `contest-leaderboard-picks-${entry.entryId}`;
  return (
    <Tile
      className={isMine ? 'border-primary/40' : undefined}
      data-mine={isMine || undefined}
      data-testid={`contest-leaderboard-entry-${entry.entryId}`}
      id={entryBlockId(entry.entryId)}
      padding="none"
      radius="lg"
      variant="subtle"
    >
      {/* #389 — the grey entry bar is the toggle for its own participant rows. */}
      <Button
        aria-controls={picksId}
        aria-expanded={!isCollapsed}
        className={cn(
          'flex w-full flex-wrap items-baseline justify-between gap-3 rounded-none bg-muted px-4 py-3 text-left font-normal',
          isCollapsed ? 'rounded-[inherit]' : 'rounded-t-[inherit] border-b border-border',
        )}
        data-testid={`contest-leaderboard-entry-toggle-${entry.entryId}`}
        onClick={onToggle}
        size="auto"
        variant="ghost"
      >
        <span className="block min-w-0">
          <span className="flex flex-wrap items-baseline gap-2">
            <span
              className="text-sm font-semibold text-muted-foreground"
              data-testid={`contest-leaderboard-position-${entry.entryId}`}
            >
              {entry.displayPosition ?? NO_SCORE}
            </span>
            <span className="font-medium text-foreground">{entry.entryName}</span>
            {isMine ? <Chip tone="active">Yours</Chip> : null}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {entry.squadName} · best {entry.countingPickLimit} of {entry.picks.length} count ·{' '}
            {entry.scoredPickCount} scored
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
          className="text-lg font-semibold text-foreground"
          data-testid={`contest-leaderboard-total-${entry.entryId}`}
        >
          {entry.total ?? NO_SCORE}
        </span>
      </Button>

      {isCollapsed ? null : entry.picks.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground" id={picksId}>
          This entry has no scored picks yet.
        </p>
      ) : (
        <div className="divide-y divide-border" id={picksId}>
          {entry.picks.map((pick) => (
            <PickRow entryId={entry.entryId} gridTemplateColumns={gridTemplateColumns} key={pick.pickId} pick={pick} />
          ))}
        </div>
      )}
    </Tile>
  );
}

export function ContestLeaderboardPage() {
  const displayPreferences = useDisplayPreferences();
  const logger = getLogger().child({ feature: 'contest-leaderboard' });
  const { contestId = '', leagueCode: routeLeagueCode } = useParams<{
    contestId: string;
    leagueCode?: string;
  }>();
  const location = useLocation();
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;

  // #389 — which entries' participant rows are hidden. Keyed by entry id so it survives the live
  // polls; an entry that first appears mid-session starts expanded like every other.
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<ReadonlySet<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  // Set by Jump to my entry; once the page holding that entry renders, it is scrolled into view.
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);
  // Which event's picks the board shows (#713); null is the server's choice, its latest revealed.
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const contestQuery = useQuery({
    queryKey: QueryKeys.contests.detail(contestId),
    queryFn: async (): Promise<ContestDto> => {
      const response = await getContest({ path: { contestId } });

      if (!response.data?.contest) {
        throwApiError(response.error, 'Contest detail response is missing data.');
      }

      refreshOnContestStatusChange(
        queryClient,
        QueryKeys.contests.detail(contestId),
        response.data.contest.status,
        leaderboardKeyFor(contestId, response.data.contest.selectionType),
      );
      return response.data.contest;
    },
    enabled: Boolean(contestId),
    retry: false,
    refetchInterval: (query) => contestRefetchInterval(query.state.data?.status),
  });

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
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    enabled: Boolean(contestId),
    retry: false,
  });
  const { league, viewer } = useLeagueContextById(contestQuery.data?.leagueId);
  const leagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;

  useEffect(() => {
    if (!jumpTargetId) {
      return;
    }
    document.getElementById(entryBlockId(jumpTargetId))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setJumpTargetId(null);
  }, [jumpTargetId, pageIndex]);

  useEffect(() => {
    if (!leaderboardQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'contestLeaderboard.load.failed',
        data: { contestId, leagueCode: hintedLeagueCode ?? null },
        err: leaderboardQuery.error,
      },
      'Contest leaderboard failed to load',
    );
  }, [contestId, hintedLeagueCode, leaderboardQuery.error, leaderboardQuery.isError, logger]);

  if (contestQuery.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
  }

  if (contestQuery.data && isBracket) {
    return <BracketLeaderboard contest={contestQuery.data} leagueCode={leagueCode} />;
  }
  if (contestQuery.data && isPickEm) {
    return <PickEmLeaderboard contest={contestQuery.data} leagueCode={leagueCode} />;
  }
  if (contestQuery.data && isSurvivor) {
    return <SurvivorLeaderboard contest={contestQuery.data} leagueCode={leagueCode} />;
  }
  if (contestQuery.data && isSquares) {
    return <SquaresLeaderboard contest={contestQuery.data} leagueCode={leagueCode} />;
  }

  if (leaderboardQuery.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
  }

  if (leaderboardQuery.isError) {
    return (
      <ErrorState
        body={extractErrorMessage(leaderboardQuery.error, {
          codeMessages: LEADERBOARD_ERROR_MESSAGES,
          fallback: 'Try refreshing, or return to the contest board.',
        })}
        testId={
          // The refusal's code is in the test id, so a browser test can tell picks-hidden from
          // a membership refusal or a server failure.
          leaderboardQuery.error instanceof ApiError && leaderboardQuery.error.code
            ? `contest-leaderboard-error-${leaderboardQuery.error.code}`
            : 'contest-leaderboard-error'
        }
        title="We couldn't load this leaderboard."
      />
    );
  }

  if (contestQuery.isError || !contestQuery.data || !leaderboardQuery.data) {
    return (
      <ErrorState
        body="Try refreshing or return to League Home."
        title="We couldn't load this contest."
      />
    );
  }

  const contest = contestQuery.data;
  const view = buildLeaderboardView(leaderboardQuery.data);
  const participantNoun = eventSportDefinition(leaderboardQuery.data).vocabulary.participant;
  const gridTemplateColumns = leaderboardGridColumns(view);
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
    setSearch('');
    setPageIndex(Math.floor(myBestIndex / LEADERBOARD_PAGE_SIZE));
    setCollapsedEntryIds((current) => {
      const next = new Set(current);
      next.delete(target.entryId);
      return next;
    });
    setJumpTargetId(target.entryId);
  };

  return (
    <section className="space-y-6" data-testid="contest-leaderboard">
      <ContestHeader
        badges={<ContestStatusBadge status={contest.status} />}
        menu={leagueCode ? (
          <ContestSubMenu
            contestId={contestId}
            current="leaderboard"
            leagueCode={leagueCode}
            myEntryId={contestEntriesQuery.data?.myEntryIds?.[0] ?? null}
            picksRevealed
          />
        ) : null}
        title={contest.name}
        titleTestId="contest-leaderboard-heading"
      >
        <div className="mt-2 space-y-2">
          {view.currentRoundLabel ? (
            <Chip data-testid="contest-leaderboard-round-cue" tone="info">
              {view.currentRoundLabel}
            </Chip>
          ) : null}
          {contest.status === ContestStatus.COMPLETED ? (
            // #246 — an entry's standing is frozen at settlement while each participant's own
            // score stays live, so a late correction can make the two disagree on this very
            // page. Say so rather than let it read as a bug.
            <p className="text-sm text-muted-foreground" data-testid="contest-leaderboard-settled-note">
              {`Final result, settled ${formatDateTimeDisplay(contest.endsAt, displayPreferences, 'at the end of the event')}. Entry standings are frozen at settlement; ${participantNoun.one} scores show current event data and can differ after a late score correction.`}
            </p>
          ) : null}
        </div>
      </ContestHeader>

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
          className="grid gap-2 px-4 pb-2 text-xs font-medium uppercase text-muted-foreground"
          data-testid="contest-leaderboard-column-headers"
          style={{ gridTemplateColumns }}
        >
          <span>Pos</span>
          <span>{capitalize(participantNoun.one)}</span>
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
                isMine={mySquadId !== null && entry.squadId === mySquadId}
                key={entry.entryId}
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
    </section>
  );
}

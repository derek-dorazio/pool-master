import { ContestStatus, SelectionType, formatSelectionTypeName } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { describeContestNextStep } from '@/features/contests/my-contest-entry';
import { StartEntryButton } from '@/features/contests/start-entry-button';
import type { MyContestEntries } from '@/features/contests/use-contest-entries';
import { useBracketLeaderboardQuery, useContestLeaderboardQuery } from '@/features/contests/use-contest-leaderboard';
import { listedContestStartsAt } from '@/features/contests/use-contest-schedule';
import {
  Countdown,
  Eyebrow,
  HeroTile,
  LinkButton,
  QueryState,
  StatusBadge,
  Text,
  Tile,
  cn,
  formatCount,
  formatDateTimeDisplay,
  formatNumber,
  formatPlace,
  useDisplayPreferences,
} from '@/features/shared/ui';
import {
  buildBracketTopStandings,
  buildTopStandings,
  describeLiveProgress,
  type StandingRow,
} from './league-home';
import { buildLeagueContestPath } from './league-routing';

/**
 * League Home's hero tiles (#1763): up to three contests that matter now, in one row on a
 * computer and stacked on a phone. A live contest is a navy tile with a red top edge; one taking
 * entries is navy with a gold edge and a gold countdown. A tap anywhere outside a hero's buttons
 * opens the contest page.
 */
export function ContestHeroes({
  contests,
  focusContestId,
  hasTeam,
  leagueCode,
  myEntries,
  mySquadId,
  now,
}: {
  /** The heroes, in order, one to three. */
  contests: readonly ContestDto[];
  focusContestId: string | null;
  hasTeam: boolean;
  leagueCode: string;
  myEntries: MyContestEntries;
  mySquadId: string | null;
  now: Date;
}) {
  return (
    <div className={cn('grid items-stretch gap-4', HERO_COLUMNS[contests.length] ?? HERO_COLUMNS[3])} data-testid="league-home-heroes">
      {contests.map((contest) => contest.status === ContestStatus.ACTIVE ? (
        <LiveHero
          contest={contest}
          isHighlighted={contest.id === focusContestId}
          key={contest.id}
          leagueCode={leagueCode}
          myEntries={myEntries}
          mySquadId={mySquadId}
        />
      ) : (
        <OpenHero
          contest={contest}
          hasTeam={hasTeam}
          isHighlighted={contest.id === focusContestId}
          key={contest.id}
          leagueCode={leagueCode}
          myEntries={myEntries}
          now={now}
        />
      ))}
    </div>
  );
}

/** One row on a computer whatever the count: a lone hero takes the whole row, two or three share it. */
const HERO_COLUMNS: Record<number, string> = {
  1: '',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-2 lg:grid-cols-3',
};

/**
 * A live contest's hero: LIVE and its progress, its name, the viewer's best place in big type
 * with how many entered and its total, then the top three plus each of the viewer's own rows, and
 * the Leaderboard button. A viewer not in it sees the top three alone. Each live hero reads its
 * own leaderboard, one request per hero.
 */
function LiveHero({
  contest,
  isHighlighted,
  leagueCode,
  myEntries,
  mySquadId,
}: {
  contest: ContestDto;
  isHighlighted: boolean;
  leagueCode: string;
  myEntries: MyContestEntries;
  mySquadId: string | null;
}) {
  const { locale } = useDisplayPreferences();
  const testId = `league-home-hero-${contest.id}`;
  // A bracket contest's standings are their own read (#721).
  const isBracket = contest.selectionType === SelectionType.BRACKET;
  const rosterQuery = useContestLeaderboardQuery(contest.id, contest.status, { enabled: !isBracket });
  const bracketQuery = useBracketLeaderboardQuery(contest.id, contest.status, { enabled: isBracket });
  const standings = isBracket
    ? bracketQuery.data ? buildBracketTopStandings(bracketQuery.data, mySquadId) : null
    : rosterQuery.data ? buildTopStandings(rosterQuery.data, mySquadId) : null;
  const leaderboardQuery = isBracket ? bracketQuery : rosterQuery;
  const isError = leaderboardQuery.isError;
  const bestPlace = myEntries.bestPlaceByContestId.get(contest.id);
  const myBestRow = standings && bestPlace
    ? [...standings.rows, ...standings.myRowsBelow].find((row) => row.entryId === bestPlace.entryId)
    : undefined;
  // The contest list counts its progress (#1782): no games read here.
  const progress = describeLiveProgress(contest, locale);
  // A viewer with no entry in it watches it (the approved mock); one in it reads their leaderboard.
  const isIn = Boolean(myEntries.entriesByContestId.get(contest.id)?.length) || bestPlace !== undefined;
  const entered = formatNumber(contest.entryCount ?? 0, locale);

  return (
    <HeroTile
      actions={(
        <LinkButton data-testid={`${testId}-leaderboard`} size="sm" to={buildLeagueContestPath(leagueCode, contest.id)}>
          {isIn ? 'Leaderboard' : 'Watch'}
        </LinkButton>
      )}
      edge="live"
      eyebrow={(
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="live">Live</StatusBadge>
          {progress ? <Eyebrow data-testid={`${testId}-progress`} tone="inverse">{progress}</Eyebrow> : null}
        </div>
      )}
      isHighlighted={isHighlighted}
      testId={testId}
      title={contest.name}
      to={buildLeagueContestPath(leagueCode, contest.id)}
    >
      {bestPlace ? (
        <div className="flex flex-wrap items-baseline gap-2" data-testid={`${testId}-place`}>
          <Text size="xl" variant="numeral">{formatPlace(bestPlace)}</Text>
          <Text tone="onInverseMuted">
            {myBestRow?.total ? `of ${entered} · ${myBestRow.total}` : `of ${entered}`}
          </Text>
        </div>
      ) : null}
      {/* The standings sit on the deeper navy, so the shared states read on it as on a card. */}
      <Tile as="div" className="relative" data-testid={`${testId}-standings`} padding="none" variant="inverseDeep">
        <QueryState
          empty="No submitted entries yet."
          error="We couldn't load the standings."
          isEmpty={(top) => !top.rows.length}
          loading="Loading standings..."
          query={{ data: standings ?? undefined, isError, refetch: leaderboardQuery.refetch }}
          rows={3}
        >
          {(top) => (
            <ol className="divide-y divide-inverse-border">
              {[...top.rows, ...top.myRowsBelow].map((row) => <HeroStandingRow key={row.entryId} row={row} testId={testId} />)}
            </ol>
          )}
        </QueryState>
      </Tile>
    </HeroTile>
  );
}

function HeroStandingRow({ row, testId }: { row: StandingRow; testId: string }) {
  return (
    <li
      className={cn('flex items-center justify-between gap-3 px-3 py-1.5', row.isMine ? 'bg-on-inverse-hover' : undefined)}
      data-mine={row.isMine || undefined}
      data-testid={`${testId}-standing-${row.entryId}`}
    >
      <Text truncate weight={row.isMine ? 'semibold' : undefined}>
        {`${row.position ?? '–'} · ${row.name}${row.isMine ? ' (you)' : ''}`}
      </Text>
      <Text variant="value" tone="inherit" weight={row.isMine ? 'semibold' : undefined}>{row.total ?? '–'}</Text>
    </li>
  );
}

/**
 * A contest taking entries: "Open for entries" and its kind, its name, when entries close and a
 * countdown, then the viewer's next step in gold (Make your picks, or Edit picks and Add entry)
 * with a muted note: how many have entered, or which of the viewer's entries is in.
 */
function OpenHero({
  contest,
  hasTeam,
  isHighlighted,
  leagueCode,
  myEntries,
  now,
}: {
  contest: ContestDto;
  hasTeam: boolean;
  isHighlighted: boolean;
  leagueCode: string;
  myEntries: MyContestEntries;
  now: Date;
}) {
  const displayPreferences = useDisplayPreferences();
  const testId = `league-home-hero-${contest.id}`;
  const entries = myEntries.entriesByContestId.get(contest.id);
  const step = describeContestNextStep({
    bestPlace: undefined,
    contest,
    entriesState: myEntries.state,
    hasTeam,
    leagueCode,
    myEntries: entries,
    now,
  });
  const closesAt = listedContestStartsAt(contest);
  const entryCount = formatCount(contest.entryCount ?? 0, 'entry', displayPreferences.locale, 'entries');
  const note = step.kind === 'note'
    ? step.note
    : step.kind === 'entered' && entries?.length
      ? entries.length === 1 && entries[0] ? `${entries[0].name} is in` : `Your ${formatNumber(entries.length, displayPreferences.locale)} entries are in`
      : `${entryCount} so far`;

  return (
    <HeroTile
      actions={(
        <>
          {step.kind === 'start' ? (
            <StartEntryButton contestId={contest.id} label="Make your picks" leagueCode={leagueCode} size="sm" testId={`${testId}-make-picks`} />
          ) : step.kind === 'entered' ? (
            <>
              <LinkButton data-testid={`${testId}-edit-picks`} size="sm" to={step.edit.to}>{step.edit.label}</LinkButton>
              {step.canAddEntry ? (
                <StartEntryButton contestId={contest.id} label="Add entry" leagueCode={leagueCode} size="sm" testId={`${testId}-add-entry`} variant="inverse" />
              ) : null}
            </>
          ) : null}
          <Text data-testid={`${testId}-note`} tone="onInverseMuted">{note}</Text>
        </>
      )}
      edge="open"
      eyebrow={<Eyebrow tone="inverse">{`Open for entries · ${formatSelectionTypeName(contest.selectionType)}`}</Eyebrow>}
      isHighlighted={isHighlighted}
      testId={testId}
      title={contest.name}
      to={buildLeagueContestPath(leagueCode, contest.id)}
    >
      {closesAt ? (
        <>
          <Text data-testid={`${testId}-closes`} tone="onInverseMuted">
            {`Entries close ${formatDateTimeDisplay(closesAt, displayPreferences)}`}
          </Text>
          <Countdown label="Entries close in" now={now} testId={`${testId}-countdown`} tone="inverseAccent" until={closesAt} />
        </>
      ) : null}
    </HeroTile>
  );
}

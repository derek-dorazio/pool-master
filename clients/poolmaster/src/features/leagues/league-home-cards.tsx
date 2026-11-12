import { useState } from 'react';
import { SelectionType } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto, ContestEntryPlaceDto, SquadDto } from '@/lib/api';
import { CurrentContestList } from '@/features/contests/current-contest-list';
import { ContestStatusBadge } from '@/features/contests/contest-status-badge';
import { EntryDetailsPeek } from '@/features/contests/entry-details-peek';
import { MineMarker } from '@/features/contests/mine-marker';
import { useBracketLeaderboardQuery, useContestLeaderboardQuery } from '@/features/contests/use-contest-leaderboard';
import {
  Countdown,
  Eyebrow,
  formatDateTimeDisplay,
  Heading,
  LinkButton,
  LoadingState,
  SectionCard,
  SectionEmpty,
  SectionRow,
  SectionRows,
  QueryState,
  SegmentedControl,
  SimpleTable,
  TableBody,
  TableCell,
  TableRow,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { formatOwnerCount } from '@/features/teams/team-directory';
import {
  buildBracketTopStandings,
  buildTopStandings,
  type StandingRow,
  type UpNextContest,
} from './league-home';
import {
  describeMyEntry,
  type MyEntriesState,
} from '@/features/contests/my-contest-entry';
import { cupProgress, cupsOnShow, describeCupStanding } from '@/features/championships/cup-view';
import { useSeasonCupsQuery } from '@/features/championships/use-cups-query';
import {
  buildLeagueContestLeaderboardPath,
  buildLeagueContestsPath,
  buildLeaguePointsRacePath,
  buildLeagueTeamPath,
  buildLeagueTrophyCasePath,
} from './league-routing';

export function UpNextCard({
  entriesState,
  hasTeam,
  leagueCode,
  myEntries,
  now,
  upNext,
}: {
  entriesState: MyEntriesState;
  hasTeam: boolean;
  leagueCode: string;
  myEntries: readonly ContestEntryDto[] | undefined;
  now: Date;
  upNext: UpNextContest;
}) {
  const displayPreferences = useDisplayPreferences();
  const next = describeMyEntry(leagueCode, upNext.contest, myEntries, entriesState, hasTeam);

  return (
    <Tile
      aria-labelledby="league-home-up-next-title"
      as="section"
      className="grid gap-4 p-6"
      data-testid="league-home-up-next"
      padding="none"
      radius="panel"
      variant="inverse"
    >
      <Eyebrow tone="inverse">Up next · Open for entries</Eyebrow>
      <Heading level={2} variant="card" size="2xl" tone="inherit" id="league-home-up-next-title">
        {upNext.contest.name}
      </Heading>
      <p className="text-sm text-on-inverse-muted">
        Entries close {formatDateTimeDisplay(upNext.closesAt, displayPreferences)}.
      </p>
      <Countdown label="Entries close in" now={now} testId="league-home-countdown" tone="inverse" until={upNext.closesAt} />
      <div className="flex flex-wrap items-center gap-3">
        <LinkButton data-testid="league-home-up-next-action" size="sm" to={next.to}>
          {next.label}
        </LinkButton>
        <span className="text-sm text-on-inverse-muted">{next.note}</span>
      </div>
    </Tile>
  );
}

/**
 * League Home's Current contests card (#1390, #1561): the shared current-contest list, less the
 * Up next contest, always shown, with one italic line when nothing else is open or live.
 */
export function CurrentContestsCard({
  bestPlaceByContestId,
  contests,
  emptyBody,
  entriesByContestId,
  entriesState,
  hasTeam,
  leagueCode,
}: {
  bestPlaceByContestId: ReadonlyMap<string, ContestEntryPlaceDto>;
  contests: readonly ContestDto[];
  emptyBody: string;
  entriesByContestId: ReadonlyMap<string, readonly ContestEntryDto[]>;
  entriesState: MyEntriesState;
  hasTeam: boolean;
  leagueCode: string;
}) {
  return (
    <SectionCard
      footer={{ label: 'All contests', testId: 'league-home-all-contests', to: buildLeagueContestsPath(leagueCode) }}
      testId="league-home-current-contests"
      title="Current contests"
    >
      <CurrentContestList
        bestPlaceByContestId={bestPlaceByContestId}
        contests={contests}
        emptyBody={emptyBody}
        entriesByContestId={entriesByContestId}
        entriesState={entriesState}
        hasTeam={hasTeam}
        leagueCode={leagueCode}
        showDrafts={false}
        testIdPrefix="league-home-contest"
      />
    </SectionCard>
  );
}

function StandingsRow({ leagueCode, leagueId, row }: { leagueCode: string; leagueId: string; row: StandingRow }) {
  return (
    <TableRow className="first:border-t-0" isHighlighted={row.isMine}>
      <TableCell className="w-10 text-muted-foreground" numeric align="left">{row.position ?? '–'}</TableCell>
      <TableCell className="px-2 font-semibold text-foreground">
        <span className="inline-flex flex-wrap items-center gap-x-1">
          {row.name}
          <EntryDetailsPeek
            className="-my-2"
            entryName={row.name}
            leagueCode={leagueCode}
            leagueId={leagueId}
            squadId={row.squadId}
            testId={`league-home-standing-peek-${row.entryId}`}
          />
          {row.isMine ? <span className="ml-1 inline-block"><MineMarker /></span> : null}
        </span>
      </TableCell>
      <TableCell numeric>{row.total ?? '–'}</TableCell>
    </TableRow>
  );
}

/**
 * Live standings (#1391): a chip for every live contest the viewer has an entry in, the first
 * chosen to start, and the chosen contest's top five with their own row if lower. Only the chosen
 * contest's leaderboard is read, so Home makes one leaderboard request however many are live.
 */
export function LiveStandingsCard({
  contests,
  leagueCode,
  mySquadId,
}: {
  /** The live contests the viewer has an entry in, at least one. */
  contests: readonly ContestDto[];
  leagueCode: string;
  mySquadId: string | null;
}) {
  const [chosenId, setChosenId] = useState(contests[0].id);
  // A contest that went final since the chip was chosen falls back to the first one still live.
  const contest = contests.find((candidate) => candidate.id === chosenId) ?? contests[0];

  return (
    <SectionCard
      footer={{
        label: 'Full leaderboard',
        testId: 'league-home-full-leaderboard',
        to: buildLeagueContestLeaderboardPath(leagueCode, contest.id),
      }}
      testId="league-home-live-standings"
      title={`${contest.name} · Top 5`}
      trailing={<ContestStatusBadge status={contest.status} />}
    >
      {contests.length > 1 ? (
        <div className="border-b border-border px-4 py-3">
          <SegmentedControl
            aria-label="Live contest to show"
            onChange={setChosenId}
            options={contests.map((option) => ({
              label: option.name,
              testId: `league-home-live-standings-chip-${option.id}`,
              value: option.id,
            }))}
            value={contest.id}
          />
        </div>
      ) : null}
      <TopStandings contest={contest} key={contest.id} leagueCode={leagueCode} mySquadId={mySquadId} />
    </SectionCard>
  );
}

/** One live contest's top five, read from its own leaderboard. */
function TopStandings({ contest, leagueCode, mySquadId }: { contest: ContestDto; leagueCode: string; mySquadId: string | null }) {
  // A bracket contest's standings are their own read (#721).
  const isBracket = contest.selectionType === SelectionType.BRACKET;
  const rosterQuery = useContestLeaderboardQuery(contest.id, contest.status, { enabled: !isBracket });
  const bracketQuery = useBracketLeaderboardQuery(contest.id, contest.status, { enabled: isBracket });
  const leaderboardQuery = isBracket ? bracketQuery : rosterQuery;
  const standings = isBracket
    ? bracketQuery.data ? buildBracketTopStandings(bracketQuery.data, mySquadId) : null
    : rosterQuery.data ? buildTopStandings(rosterQuery.data, mySquadId) : null;

  return (
    <QueryState
      empty="No submitted entries yet."
      error="We couldn't load the standings."
      isEmpty={(top) => !top.rows.length}
      loading="Loading standings..."
      query={{ data: standings ?? undefined, isError: leaderboardQuery.isError, refetch: leaderboardQuery.refetch }}
      rows={3}
    >
      {(top) => (
        <SimpleTable>
          <TableBody>
            {top.rows.map((row) => <StandingsRow key={row.entryId} leagueCode={leagueCode} leagueId={contest.leagueId} row={row} />)}
            {top.myRowBelow ? <StandingsRow leagueCode={leagueCode} leagueId={contest.leagueId} row={top.myRowBelow} /> : null}
          </TableBody>
        </SimpleTable>
      )}
    </QueryState>
  );
}

export function YourTeamCard({
  isLoading,
  leagueCode,
  team,
}: {
  isLoading: boolean;
  leagueCode: string;
  team: SquadDto | null;
}) {
  return (
    <SectionCard
      footer={{ label: team ? 'My team' : 'Create your team', testId: 'league-home-my-team', to: buildLeagueTeamPath(leagueCode) }}
      testId="league-home-your-team"
      title="Yours"
    >
      {isLoading ? (
        <LoadingState size="inline" />
      ) : team ? (
        <SectionRows>
          <SectionRow facts={formatOwnerCount(team)} name={team.name} testId="league-home-your-team-row" />
        </SectionRows>
      ) : (
        <SectionEmpty>You haven&apos;t created your team in this league yet.</SectionEmpty>
      )}
    </SectionCard>
  );
}

const HOME_CUPS = 3;

/**
 * The year's sports league cups (#841): who leads each and where the viewer stands, linking to its
 * Points race. Shown once a cup is on show in the Trophy case, which has them all.
 */
export function CupsCard({
  leagueCode,
  leagueId,
  mySquadId,
  year,
}: {
  leagueCode: string;
  leagueId: string;
  mySquadId: string | null;
  year: number;
}) {
  const cupsQuery = useSeasonCupsQuery(leagueId, year);
  const cups = cupsOnShow(cupsQuery.data ?? []);
  if (!cups.length) {
    return null;
  }

  return (
    <SectionCard
      footer={{ label: 'Trophy case', testId: 'league-home-trophy-case', to: buildLeagueTrophyCasePath(leagueCode, year) }}
      testId="league-home-cups"
      title={`${year} cups`}
    >
      <SectionRows>
        {cups.slice(0, HOME_CUPS).map((cup) => {
          const progress = cupProgress(cup);
          return (
            <SectionRow
              facts={`${describeCupStanding(cup, { squadId: mySquadId, isViewer: true })} · ${progress.final} of ${progress.total} final`}
              key={cup.id}
              name={cup.name}
              testId={`league-home-cup-${cup.id}`}
              to={buildLeaguePointsRacePath(leagueCode, year, cup.sportLeagueId)}
            />
          );
        })}
      </SectionRows>
    </SectionCard>
  );
}

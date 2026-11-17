import { useState } from 'react';
import { SelectionType } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { CurrentContestList } from '@/features/contests/current-contest-list';
import { EntryDetailsPeek } from '@/features/contests/entry-details-peek';
import { MineMarker } from '@/features/contests/mine-marker';
import type { MyContestEntries } from '@/features/contests/use-contest-entries';
import { useBracketLeaderboardQuery, useContestLeaderboardQuery } from '@/features/contests/use-contest-leaderboard';
import {
  PageTabs,
  QueryState,
  SectionCard,
  SectionRow,
  SectionRows,
  SimpleTable,
  TableBody,
  TableCell,
  TableRow,
  Tabs,
  TabsContent,
} from '@/features/shared/ui';
import {
  buildBracketTopStandings,
  buildTopStandings,
  orderLiveStandings,
  type StandingRow,
} from './league-home';
import { cupProgress, cupsOnShow, describeCupStanding } from '@/features/championships/cup-view';
import { useSeasonCupsQuery } from '@/features/championships/use-cups-query';
import {
  buildLeagueContestPath,
  buildLeaguePointsRacePath,
  buildLeagueTrophyCasePath,
} from './league-routing';

/**
 * League Home's Contests card (#1763): every current contest, entered or not, each with the
 * viewer's next step, in the one list the league has. It is always shown, with one italic line
 * when nothing is open or live.
 */
export function ContestsCard({
  canExpand,
  contests,
  focusContestId,
  hasTeam,
  leagueCode,
  myEntries,
  now,
  showDrafts,
}: {
  canExpand: boolean;
  contests: readonly ContestDto[];
  focusContestId: string | null;
  hasTeam: boolean;
  leagueCode: string;
  myEntries: MyContestEntries;
  now: Date;
  showDrafts: boolean;
}) {
  return (
    <SectionCard testId="league-home-contests" title="Contests">
      <CurrentContestList
        canExpand={canExpand}
        contests={contests}
        emptyBody="No open or live contests."
        focusContestId={focusContestId}
        hasTeam={hasTeam}
        leagueCode={leagueCode}
        myEntries={myEntries}
        now={now}
        showDrafts={showDrafts}
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
 * Live standings (#1391, #1763): a tab for every live contest in the league, the ones the viewer
 * has an entry in first, each group by start, and the chosen contest's top five, with the
 * viewer's own row if lower. A contest they are not in shows its top five alone. Only the chosen
 * tab's leaderboard is read, so Home makes one leaderboard request however many are live.
 */
export function LiveStandingsCard({
  contests,
  leagueCode,
  myContestIds,
  mySquadId,
}: {
  /** The league's live contests, at least one. */
  contests: readonly ContestDto[];
  leagueCode: string;
  /** The contests the viewer's team has an entry in. */
  myContestIds: ReadonlySet<string>;
  mySquadId: string | null;
}) {
  const ordered = orderLiveStandings(contests, myContestIds);
  const [chosenId, setChosenId] = useState(ordered[0].id);
  // A contest that went final since its tab was chosen falls back to the first one still live.
  const contest = ordered.find((candidate) => candidate.id === chosenId) ?? ordered[0];

  return (
    <SectionCard
      footer={{
        label: 'Full leaderboard',
        testId: 'league-home-full-leaderboard',
        to: buildLeagueContestPath(leagueCode, contest.id),
      }}
      testId="league-home-live-standings"
      title="Live standings"
    >
      <Tabs onValueChange={setChosenId} value={contest.id}>
        <div className="border-b border-border px-4">
          <PageTabs
            aria-label="Live contest to show"
            items={ordered.map((option) => ({
              label: option.name,
              testId: `league-home-live-standings-tab-${option.id}`,
              value: option.id,
            }))}
            variant="state"
          />
        </div>
        {/* Only the open tab's panel mounts, so only its leaderboard is read. */}
        <TabsContent className="focus-visible:outline-none" value={contest.id}>
          <TopStandings contest={contest} key={contest.id} leagueCode={leagueCode} mySquadId={mySquadId} />
        </TabsContent>
      </Tabs>
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

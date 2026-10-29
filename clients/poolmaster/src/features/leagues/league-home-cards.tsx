import type { ReactNode } from 'react';
import { ContestStatus, SelectionType, SquadMembershipStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto, SquadDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import { ContestRow } from '@/features/contests/contest-row';
import { ContestStatusBadge } from '@/features/contests/contest-status-badge';
import { MineMarker } from '@/features/contests/mine-marker';
import { listedContestStartsAt } from '@/features/contests/use-contest-schedule';
import { useBracketLeaderboardQuery, useContestLeaderboardQuery } from '@/features/contests/use-contest-leaderboard';
import {
  cn,
  Eyebrow,
  formatDateTimeDisplay,
  Heading,
  LinkButton,
  LOADING_TEXT,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { TeamName } from '@/features/teams/team-name';
import {
  buildBracketTopStandings,
  buildTopStandings,
  countdownUntil,
  type StandingRow,
  type UpNextContest,
} from './league-home';
import {
  describeMyEntry,
  ENTRY_STATE_NOTE,
  type MyEntriesState,
} from '@/features/contests/my-contest-entry';
import { cupProgress, cupsOnShow, describeCupStanding } from '@/features/championships/cup-view';
import { useSeasonCupsQuery } from '@/features/championships/use-cups-query';
import {
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
  buildLeagueContestsPath,
  buildLeaguePointsRacePath,
  buildLeagueTeamPath,
  buildLeagueTrophyCasePath,
} from './league-routing';

function HomeCard({
  children,
  footer,
  testId,
  title,
  trailing,
}: {
  children: ReactNode;
  footer?: { label: string; testId: string; to: string };
  testId: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={testId}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Heading level={2} variant="card" size="sm">{title}</Heading>
        {trailing}
      </div>
      {children}
      {footer ? (
        <LinkButton
          className="rounded-none border-t border-border"
          layout="row"
          data-testid={footer.testId}
          size="sm"
          to={footer.to}
          variant="ghost"
        >
          {footer.label} →
        </LinkButton>
      ) : null}
    </section>
  );
}

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
  const countdown = countdownUntil(upNext.closesAt, now);
  const next = describeMyEntry(leagueCode, upNext.contest, myEntries, entriesState, hasTeam);
  const parts = [
    { label: 'Days', value: countdown.days },
    { label: 'Hours', value: countdown.hours },
    { label: 'Min', value: countdown.minutes },
  ];

  return (
    <Tile
      aria-labelledby="league-home-up-next-title"
      as="section"
      className="grid gap-4 p-6"
      data-testid="league-home-up-next"
      padding="none"
      radius="md"
      variant="inverse"
    >
      <Eyebrow tone="inverse">Up next · Open for entries</Eyebrow>
      <Heading level={2} variant="card" size="2xl" tone="inherit" id="league-home-up-next-title">
        {upNext.contest.name}
      </Heading>
      <p className="text-sm text-on-inverse-muted">
        Entries close {formatDateTimeDisplay(upNext.closesAt, displayPreferences)}.
      </p>
      <div
        aria-label={`Entries close in ${countdown.days} days ${countdown.hours} hours ${countdown.minutes} minutes`}
        className="flex gap-2"
        data-testid="league-home-countdown"
        role="timer"
      >
        {parts.map((part) => (
          <div
            className="min-w-16 rounded-xl border border-inverse-border bg-on-inverse-subtle px-3 py-2 text-center"
            key={part.label}
          >
            <b className="block font-display text-xl tabular-nums">{String(part.value).padStart(2, '0')}</b>
            <span className="text-xs uppercase tracking-label text-on-inverse-muted">{part.label}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <LinkButton data-testid="league-home-up-next-action" size="sm" to={next.to}>
          {next.label}
        </LinkButton>
        <span className="text-sm text-on-inverse-muted">{next.note}</span>
      </div>
    </Tile>
  );
}

export function OtherContestsCard({
  contests,
  entriesByContestId,
  entriesState,
  hasTeam,
  leagueCode,
}: {
  contests: readonly ContestDto[];
  entriesByContestId: ReadonlyMap<string, ContestEntryDto[]>;
  entriesState: MyEntriesState;
  hasTeam: boolean;
  leagueCode: string;
}) {
  return (
    <HomeCard
      footer={{ label: 'All contests', testId: 'league-home-all-contests', to: buildLeagueContestsPath(leagueCode) }}
      testId="league-home-other-contests"
      title="Other contests"
    >
      {contests.length ? (
        <ul className="divide-y divide-border">
          {contests.map((contest) => {
            const hasEntry = (entriesByContestId.get(contest.id)?.length ?? 0) > 0;
            return (
              <li key={contest.id}>
                <ContestRow
                  density="compact"
                  name={contest.name}
                  note={!hasTeam
                    ? 'Choose your name in this league to enter'
                    : entriesState !== 'ready'
                      ? ENTRY_STATE_NOTE[entriesState]
                      : hasEntry ? 'You have an entry' : 'You haven’t entered'}
                  startsAt={listedContestStartsAt(contest)}
                  state={{ leagueCode }}
                  status={<ContestStatusBadge status={contest.status} />}
                  testId={`league-home-contest-${contest.id}`}
                  to={contest.status === ContestStatus.ACTIVE
                    ? buildLeagueContestLeaderboardPath(leagueCode, contest.id)
                    : buildLeagueContestPath(leagueCode, contest.id)}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-muted-foreground">No other contests are open or live right now.</p>
      )}
    </HomeCard>
  );
}

function StandingsRow({ row }: { row: StandingRow }) {
  return (
    <tr className={cn('border-t border-border first:border-t-0', row.isMine ? 'bg-primary/10' : undefined)}>
      <td className="w-10 px-4 py-2 text-muted-foreground">{row.position ?? '–'}</td>
      <td className="px-2 py-2 font-semibold text-foreground">
        {row.name}
        {row.isMine ? <span className="ml-2 inline-block"><MineMarker /></span> : null}
      </td>
      <td className="px-4 py-2 text-right">{row.total ?? '–'}</td>
    </tr>
  );
}

/** The top five of a live contest the viewer has an entry in, with their own row if lower. */
export function LiveStandingsCard({
  contest,
  leagueCode,
  mySquadId,
}: {
  contest: ContestDto;
  leagueCode: string;
  mySquadId: string | null;
}) {
  // A bracket contest's standings are their own read (#721).
  const isBracket = contest.selectionType === SelectionType.BRACKET;
  const rosterQuery = useContestLeaderboardQuery(contest.id, contest.status, { enabled: !isBracket });
  const bracketQuery = useBracketLeaderboardQuery(contest.id, contest.status, { enabled: isBracket });
  const leaderboardQuery = isBracket ? bracketQuery : rosterQuery;
  const standings = isBracket
    ? bracketQuery.data ? buildBracketTopStandings(bracketQuery.data, mySquadId) : null
    : rosterQuery.data ? buildTopStandings(rosterQuery.data, mySquadId) : null;

  return (
    <HomeCard
      footer={{
        label: 'Full leaderboard',
        testId: 'league-home-full-leaderboard',
        to: buildLeagueContestLeaderboardPath(leagueCode, contest.id),
      }}
      testId="league-home-live-standings"
      title={`${contest.name} · Top 5`}
      trailing={<ContestStatusBadge status={contest.status} />}
    >
      {leaderboardQuery.isLoading ? (
        <p className="px-4 py-4 text-sm text-muted-foreground" role="status">Loading standings...</p>
      ) : leaderboardQuery.isError || !standings ? (
        <p className="px-4 py-4 text-sm text-muted-foreground" role="alert">We couldn&apos;t load the standings.</p>
      ) : standings.rows.length ? (
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {standings.rows.map((row) => <StandingsRow key={row.entryId} row={row} />)}
            {standings.myRowBelow ? <StandingsRow row={standings.myRowBelow} /> : null}
          </tbody>
        </table>
      ) : (
        <p className="px-4 py-4 text-sm text-muted-foreground">No submitted entries yet.</p>
      )}
    </HomeCard>
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
  // No team yet means no owners to name.
  const owners = team
    ? team.members
      .filter((member) => member.status === SquadMembershipStatus.ACTIVE)
      .map((member) => formatUserName(member.user.firstName, member.user.lastName))
    : [];

  return (
    <HomeCard
      footer={{ label: team ? `Go to ${team.name}` : 'Choose your name', testId: 'league-home-my-team', to: buildLeagueTeamPath(leagueCode) }}
      testId="league-home-your-team"
      title="Yours"
    >
      {isLoading ? (
        <p className="px-4 py-4 text-sm text-muted-foreground" role="status">{LOADING_TEXT}</p>
      ) : team ? (
        <div className="px-4 py-4">
          <TeamName iconKey={team.iconKey} name={team.name} subtitle={owners.join(', ')} />
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-muted-foreground">You haven&apos;t chosen your name in this league yet.</p>
      )}
    </HomeCard>
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
    <HomeCard
      footer={{ label: 'Trophy case', testId: 'league-home-trophy-case', to: buildLeagueTrophyCasePath(leagueCode, year) }}
      testId="league-home-cups"
      title={`${year} cups`}
    >
      <ul>
        {cups.slice(0, HOME_CUPS).map((cup) => {
          const progress = cupProgress(cup);
          return (
            <li className="border-t border-border first:border-t-0" key={cup.id}>
              <LinkButton
                className="flex-col items-start gap-0.5 rounded-none px-4 py-3"
                layout="row"
                data-testid={`league-home-cup-${cup.id}`}
                to={buildLeaguePointsRacePath(leagueCode, year, cup.sportLeagueId)}
                variant="ghost"
              >
                <span className="font-semibold text-foreground">{cup.name}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {describeCupStanding(cup, { squadId: mySquadId, isViewer: true })} · {progress.final} of {progress.total} final
                </span>
              </LinkButton>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}

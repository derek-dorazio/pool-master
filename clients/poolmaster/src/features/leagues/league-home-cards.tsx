import type { ReactNode } from 'react';
import { ContestEntryStatus, ContestStatus, SquadMembershipStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto, SquadDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import { ContestStatusBadge } from '@/features/contests/contest-status-badge';
import { useContestLeaderboardQuery } from '@/features/contests/use-contest-leaderboard';
import {
  cn,
  formatDateTimeDisplay,
  IconAvatar,
  LinkButton,
} from '@/features/shared/ui';
import { getTeamIconOption } from '@/features/teams/team-icon-catalog';
import { TeamIcon } from '@/features/teams/team-icon';
import { buildTopStandings, countdownUntil, type StandingRow, type UpNextContest } from './league-home';
import {
  buildLeagueContestEntryPath,
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
  buildLeagueContestsPath,
  buildLeagueTeamPath,
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
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {trailing}
      </div>
      {children}
      {footer ? (
        <LinkButton
          className="w-full justify-start rounded-none border-t border-border"
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

/** What the viewer's entries in a contest mean for them, and where to go next. */
function describeMyEntry(
  leagueCode: string,
  contest: ContestDto,
  myEntries: readonly ContestEntryDto[] | undefined,
  hasTeam: boolean,
) {
  const contestPath = buildLeagueContestPath(leagueCode, contest.id);
  if (!hasTeam) {
    return { label: 'View contest', note: 'Create your team to enter.', to: contestPath };
  }
  const submitted = myEntries?.find((entry) => entry.status === ContestEntryStatus.SUBMITTED);
  if (submitted) {
    return {
      label: 'View entry',
      note: 'Your entry is submitted.',
      to: buildLeagueContestEntryPath(leagueCode, contest.id, submitted.id),
    };
  }
  const draft = myEntries?.[0];
  if (draft) {
    return {
      label: 'Finish your picks',
      note: 'Your entry is not submitted yet.',
      to: buildLeagueContestEntryPath(leagueCode, contest.id, draft.id),
    };
  }
  return { label: 'Make your picks', note: 'You have not entered yet.', to: contestPath };
}

export function UpNextCard({
  hasTeam,
  leagueCode,
  myEntries,
  now,
  upNext,
}: {
  hasTeam: boolean;
  leagueCode: string;
  myEntries: readonly ContestEntryDto[] | undefined;
  now: Date;
  upNext: UpNextContest;
}) {
  const countdown = countdownUntil(upNext.closesAt, now);
  const next = describeMyEntry(leagueCode, upNext.contest, myEntries, hasTeam);
  const parts = [
    { label: 'Days', value: countdown.days },
    { label: 'Hours', value: countdown.hours },
    { label: 'Min', value: countdown.minutes },
  ];

  return (
    <section
      aria-labelledby="league-home-up-next-title"
      className="grid gap-4 rounded-2xl border border-inverse-border bg-surface-inverse p-6 text-on-inverse"
      data-testid="league-home-up-next"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Up next · Open for entries</div>
      <h2 className="font-display text-2xl font-black" id="league-home-up-next-title">
        {upNext.contest.name}
      </h2>
      <p className="text-sm text-on-inverse-muted">
        Entries close {formatDateTimeDisplay(upNext.closesAt)}.
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
            <span className="text-[11px] uppercase tracking-[0.12em] text-on-inverse-muted">{part.label}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <LinkButton data-testid="league-home-up-next-action" size="sm" to={next.to}>
          {next.label}
        </LinkButton>
        <span className="text-sm text-on-inverse-muted">{next.note}</span>
      </div>
    </section>
  );
}

export function OtherContestsCard({
  contests,
  entriesByContestId,
  hasTeam,
  leagueCode,
}: {
  contests: readonly ContestDto[];
  entriesByContestId: ReadonlyMap<string, ContestEntryDto[]>;
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
            const isLive = contest.status === ContestStatus.ACTIVE;
            const hasEntry = (entriesByContestId.get(contest.id)?.length ?? 0) > 0;
            return (
              <li className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`league-home-contest-${contest.id}`} key={contest.id}>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-foreground">{contest.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {!hasTeam ? 'Create your team to enter' : hasEntry ? 'Your team has an entry' : 'Your team has not entered'}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <ContestStatusBadge status={contest.status} />
                  <LinkButton
                    size="sm"
                    to={isLive
                      ? buildLeagueContestLeaderboardPath(leagueCode, contest.id)
                      : buildLeagueContestPath(leagueCode, contest.id)}
                    variant="secondary"
                  >
                    {isLive ? 'Leaderboard' : 'View'}
                  </LinkButton>
                </div>
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
        {row.isMine ? <span className="font-normal text-muted-foreground"> · you</span> : null}
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
  const leaderboardQuery = useContestLeaderboardQuery(contest.id, contest.status);
  const standings = leaderboardQuery.data ? buildTopStandings(leaderboardQuery.data, mySquadId) : null;

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
  const owners = (team?.members ?? [])
    .filter((member) => member.status === SquadMembershipStatus.ACTIVE)
    .map((member) => formatUserName(member.user.firstName, member.user.lastName));

  return (
    <HomeCard
      footer={{ label: team ? 'Go to My team' : 'Create your team', testId: 'league-home-my-team', to: buildLeagueTeamPath(leagueCode) }}
      testId="league-home-your-team"
      title="Your team"
    >
      {isLoading ? (
        <p className="px-4 py-4 text-sm text-muted-foreground" role="status">Loading your team...</p>
      ) : team ? (
        <div className="flex items-center gap-3 px-4 py-4">
          <IconAvatar className={getTeamIconOption(team.iconKey).themeClass} size="sm">
            <TeamIcon iconKey={team.iconKey} size="sm" />
          </IconAvatar>
          <div className="min-w-0">
            <div className="truncate font-bold text-foreground">{team.name}</div>
            <div className="truncate text-sm text-muted-foreground">{owners.join(', ')}</div>
          </div>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-muted-foreground">You don&apos;t have a team in this league yet.</p>
      )}
    </HomeCard>
  );
}

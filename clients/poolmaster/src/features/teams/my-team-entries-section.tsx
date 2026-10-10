import { ContestStatus } from '@poolmaster/shared/domain';
import { Link } from 'react-router-dom';
import type { ContestDto } from '@/lib/api';
import { ContestStatusBadge } from '@/features/contests/contest-status-badge';
import { describeMyEntry, ENTRY_STATE_NOTE, type MyEntriesState } from '@/features/contests/my-contest-entry';
import { useMyContestEntries } from '@/features/contests/use-contest-entries';
import { useContestLeaderboardQuery } from '@/features/contests/use-contest-leaderboard';
import { useLeagueContestsQuery } from '@/features/contests/use-league-contests-query';
import {
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
  buildLeagueContestsPath,
} from '@/features/leagues/league-routing';
import { Alert, LinkButton } from '@/features/shared/ui';

/** The team's best place on a live contest's leaderboard; the server ranks best first. */
function LiveRank({ contest, teamId }: { contest: ContestDto; teamId: string }) {
  const leaderboardQuery = useContestLeaderboardQuery(contest.id, contest.status);
  const position = leaderboardQuery.data?.entries.find((entry) => entry.squadId === teamId)?.displayPosition;

  return (
    <span className="text-sm text-muted-foreground" data-testid={`my-team-entry-rank-${contest.id}`}>
      {leaderboardQuery.isLoading
        ? 'Checking your place...'
        : position
          ? `Place ${position}`
          : 'Not ranked yet'}
    </span>
  );
}

/**
 * My team's entries: every open contest, with what the team still has to do in it, and every
 * live contest the team entered, with its current place.
 */
export function MyTeamEntriesSection({
  leagueCode,
  leagueId,
  teamId,
}: {
  leagueCode: string;
  leagueId: string;
  teamId: string;
}) {
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const currentContests = (contestsQuery.data ?? []).filter(
    (contest) => contest.status === ContestStatus.OPEN || contest.status === ContestStatus.ACTIVE,
  );
  const myEntries = useMyContestEntries(currentContests.map((contest) => contest.id), teamId);
  const entriesState: MyEntriesState = myEntries.isError
    ? 'failed'
    : myEntries.isLoading ? 'loading' : 'ready';
  // A live contest the team did not enter has nothing left for it to do.
  const rows = currentContests.filter(
    (contest) => contest.status === ContestStatus.OPEN
      || entriesState !== 'ready'
      || (myEntries.entriesByContestId.get(contest.id)?.length ?? 0) > 0,
  );

  return (
    <section className="space-y-3" data-testid="my-team-entries">
      <h2 className="text-lg font-semibold text-foreground">My entries</h2>
      {contestsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading your contests...</p>
      ) : contestsQuery.isError ? (
        <Alert data-testid="my-team-entries-error" tone="danger">
          We couldn&apos;t load this league&apos;s contests.
        </Alert>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="my-team-entries-none">
          No contests are open or live right now.{' '}
          <Link className="font-medium text-foreground hover:underline" to={buildLeagueContestsPath(leagueCode)}>
            See all contests
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {rows.map((contest) => {
            const isLive = contest.status === ContestStatus.ACTIVE;
            const next = describeMyEntry(
              leagueCode,
              contest,
              myEntries.entriesByContestId.get(contest.id),
              entriesState,
              true,
            );
            return (
              <li
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                data-testid={`my-team-entry-${contest.id}`}
                key={contest.id}
              >
                <div className="min-w-0">
                  <Link
                    className="truncate font-semibold text-foreground hover:underline"
                    to={buildLeagueContestPath(leagueCode, contest.id)}
                  >
                    {contest.name}
                  </Link>
                  <div>
                    {isLive && entriesState === 'ready' ? (
                      <LiveRank contest={contest} teamId={teamId} />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {isLive ? ENTRY_STATE_NOTE[entriesState === 'failed' ? 'failed' : 'loading'] : next.note}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <ContestStatusBadge status={contest.status} />
                  <LinkButton
                    data-testid={`my-team-entry-action-${contest.id}`}
                    size="sm"
                    to={isLive ? buildLeagueContestLeaderboardPath(leagueCode, contest.id) : next.to}
                    variant="secondary"
                  >
                    {isLive ? 'Leaderboard' : next.label}
                  </LinkButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

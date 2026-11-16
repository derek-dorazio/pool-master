import { Navigate, useParams } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { ContestEntryListPage } from './contest-entry-list-page';
import { ContestPagePending } from './contest-page-pending';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import { useContestQuery } from './use-contest-query';

/** Whether a contest's page shows its leaderboard: once it is live, and when it is final. */
function showsLeaderboard(contest: Pick<ContestDto, 'status'>) {
  return contest.status === ContestStatus.ACTIVE || contest.status === ContestStatus.COMPLETED;
}

/**
 * A contest's one page (#1739), at one address for every stage: while entries are open it lists
 * who has entered, and once the contest is live it is the leaderboard. There are no tabs; the
 * stage decides the view, and a contest that goes live while the page is open turns into its
 * leaderboard, since each view reads the contest live.
 */
export function ContestPage() {
  const { contestId = '' } = useParams<{ contestId: string }>();
  const contestQuery = useContestQuery(contestId);

  if (!contestQuery.data) {
    return <ContestPagePending isError={contestQuery.isError} onRetry={() => void contestQuery.refetch()} />;
  }
  return showsLeaderboard(contestQuery.data) ? <ContestLeaderboardPage /> : <ContestEntryListPage />;
}

/** The old leaderboard address (`/contests/<contest>/leaderboard`), from links and emails sent before #1739: the contest's page. */
export function ContestLeaderboardRedirect() {
  const { contestId = '', leagueCode = '' } = useParams<{ contestId: string; leagueCode: string }>();
  return <Navigate replace to={buildLeagueContestPath(leagueCode, contestId)} />;
}

import { Link } from 'react-router-dom';
import type { ListContestsResponses } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';

type ContestSummary = ListContestsResponses[200]['contests'][number];

export function ContestListCard({
  contest,
  leagueCode,
  testId,
}: {
  contest: ContestSummary;
  leagueCode: string;
  testId: string;
}) {
  return (
    <Link
      className="block rounded-2xl border border-border bg-background px-4 py-4 transition hover:border-primary/40 hover:bg-card"
      data-testid={testId}
      state={{ leagueCode }}
      to={buildLeagueContestPath(leagueCode, contest.id)}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{contest.name}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {contest.sport} · {contest.selectionType} · {contest.scoringEngine}
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>{contest.status}</div>
          <div>{contest.entryCount ?? 0} entries</div>
        </div>
      </div>
    </Link>
  );
}

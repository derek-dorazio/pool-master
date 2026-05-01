import type { ListContestsResponses } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { ListCard } from '@/features/shared/ui';

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
    <ListCard
      data-testid={testId}
      metadata={`${contest.sport} · ${contest.selectionType} · ${contest.scoringEngine}`}
      title={contest.name}
      to={buildLeagueContestPath(leagueCode, contest.id)}
      state={{ leagueCode }}
      trailing={
        <>
          <div>{contest.status}</div>
          <div>{contest.entryCount ?? 0} entries</div>
        </>
      }
    />
  );
}

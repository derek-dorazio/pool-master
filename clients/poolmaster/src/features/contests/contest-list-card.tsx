import type { ContestDto } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { ListCard } from '@/features/shared/ui';
import { ContestStatusBadge } from './contest-status-badge';

export function ContestListCard({
  contest,
  leagueCode,
  testId,
}: {
  contest: ContestDto;
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
          <ContestStatusBadge status={contest.status} />
          <div>{contest.entryCount ?? 0} entries</div>
        </>
      }
    />
  );
}

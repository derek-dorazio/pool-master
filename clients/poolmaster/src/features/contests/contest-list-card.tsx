import type { ContestDto } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { DateDisplay, ListCard } from '@/features/shared/ui';
import { ContestStatusBadge } from './contest-status-badge';
import { useContestSchedule } from './use-contest-schedule';

export function ContestListCard({
  contest,
  leagueCode,
  testId,
}: {
  contest: ContestDto;
  leagueCode: string;
  testId: string;
}) {
  const startsAt = useContestSchedule(contest)?.startsAt;

  return (
    <ListCard
      data-testid={testId}
      description={startsAt ? (
        <span data-testid={`${testId}-starts`}>
          Starts <DateDisplay className="text-muted-foreground" value={startsAt} />
        </span>
      ) : undefined}
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

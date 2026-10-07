import type { ContestDto } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { DateDisplay, ListCard } from '@/features/shared/ui';
import { ContestStatusBadge } from './contest-status-badge';
import { useContestEventSchedule } from './use-contest-event-schedule';

export function ContestListCard({
  contest,
  leagueCode,
  testId,
}: {
  contest: ContestDto;
  leagueCode: string;
  testId: string;
}) {
  const scheduleQuery = useContestEventSchedule(contest.sportEventId);
  const startDate = scheduleQuery.data?.startDate;

  return (
    <ListCard
      data-testid={testId}
      description={startDate ? (
        <span data-testid={`${testId}-starts`}>
          Starts <DateDisplay className="text-muted-foreground" value={startDate} />
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

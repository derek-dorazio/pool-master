import { useQuery } from '@tanstack/react-query';
import type { ContestDto } from '@/lib/api';
import { survivorPickTeam } from './pick-em-week';
import { gamePicksQueryOptions } from './use-game-picks';

/**
 * The viewer's own survivor entry's pick for the week the entry list shows (#1757): "Week 1:
 * Eagles", by the week the pick is for; null with no pick yet, or for any other contest. Read
 * only when `enabled`, so another team's entry reads nothing.
 */
export function useSurvivorEntryPick(
  contest: Pick<ContestDto, 'id' | 'status'>,
  entryId: string,
  sportEventId: string | undefined,
  enabled: boolean,
): string | null {
  const picksQuery = useQuery({ ...gamePicksQueryOptions(contest, entryId, sportEventId ?? ''), enabled: enabled && sportEventId !== undefined });
  const picks = picksQuery.data;
  const team = picks ? survivorPickTeam(picks) : null;
  if (!picks || !team) {
    return null;
  }
  const weekNumber = picks.survivor?.roundWeeks.at(0)?.weekNumber;
  return weekNumber === undefined ? team.name : `Week ${weekNumber}: ${team.name}`;
}

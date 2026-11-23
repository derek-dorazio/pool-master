import { displayString } from '@poolmaster/shared/display-strings';
import { useQuery } from '@tanstack/react-query';
import type { ContestDto } from '@/lib/api';
import { teamNamesOf } from './pick-em-board';
import { isSurvivorWeek, survivorPickTeam } from './pick-em-week';
import { eventFieldQueryOptions } from './use-event-games';
import { gamePicksQueryOptions } from './use-game-picks';

/**
 * The viewer's own survivor entry's pick for the week the entry list shows (#1757): "Week 1:
 * PHI", by the week the pick is for and the team's code where it has one; null with no pick yet,
 * or for any other contest. Read only when `enabled`, so another team's entry reads nothing, and
 * a pick'em or bracket entry's week, which the pick screen may have cached, names no team.
 */
export function useSurvivorEntryPick(
  contest: Pick<ContestDto, 'id' | 'status'>,
  entryId: string,
  sportEventId: string | undefined,
  enabled: boolean,
): string | null {
  const reads = enabled && sportEventId !== undefined;
  const picksQuery = useQuery({ ...gamePicksQueryOptions(contest, entryId, sportEventId ?? ''), enabled: reads });
  const namesQuery = useQuery({ ...eventFieldQueryOptions(sportEventId ?? ''), select: teamNamesOf, enabled: reads });
  const picks = picksQuery.data;
  if (!reads || !picks || !isSurvivorWeek(picks)) {
    return null;
  }
  const team = survivorPickTeam(picks);
  if (!team) {
    return null;
  }
  const name = namesQuery.data?.get(team.sportEventParticipantId) ?? team.name;
  const weekNumber = picks.survivor?.roundWeeks.at(0)?.weekNumber;
  return weekNumber === undefined ? name : `${displayString('word.weekNumber', { n: weekNumber })}: ${name}`;
}

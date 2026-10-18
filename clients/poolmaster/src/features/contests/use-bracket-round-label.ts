import { useQuery } from '@tanstack/react-query';
import { eventRoundLabel, type Sport } from '@poolmaster/shared/domain';
import { getSportLeague, type SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { BracketRoundLabel } from './bracket-layout';
import { sportEventQueryOptions } from './use-contest-schedule';

/**
 * How a bracket's rounds are named (#706): by the event's sport league's own round names where it
 * has them (the NBA's "Conference Finals"), otherwise by the sport's. Until the event and its
 * league load, and if either read fails, the rounds take the sport's names, which are still
 * correct, only less specific.
 */
export function useBracketRoundLabel(sport: Sport | null | undefined, sportEventId: string): BracketRoundLabel {
  const eventQuery = useQuery(sportEventQueryOptions(sportEventId));
  const sportLeagueId = eventQuery.data?.sportLeagueId ?? '';
  const sportLeagueQuery = useQuery({
    queryKey: QueryKeys.sportLeagues.detail(sportLeagueId),
    queryFn: async (): Promise<SportLeagueDto> => {
      const response = await getSportLeague({ path: { sportLeagueId } });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league response is missing data.');
      }
      return response.data.sportLeague;
    },
    enabled: sportLeagueId !== '',
    retry: false,
    // A league's round names change only when an admin renames them.
    staleTime: 5 * 60_000,
  });
  const roundNames = sportLeagueQuery.data?.roundNames ?? [];
  // A contest with no sport has no round names to read; its rounds are numbered.
  return (roundNumber, roundCount) => (sport
    ? eventRoundLabel(sport, roundNames, roundNumber, roundCount)
    : `Round ${roundNumber}`);
}

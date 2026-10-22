import { useQuery } from '@tanstack/react-query';
import { eventRoundLabel, type Sport, type RoundName  } from '@poolmaster/shared/domain';
import { getSportLeague, type SportEventDto, type SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { BracketRoundLabel } from './bracket-layout';
import { bracketRoundCount } from './bracket-start-round';
import { sportEventQueryOptions } from './use-contest-schedule';

/** A sport league's shared read; an empty `sportLeagueId` reads nothing. */
export function sportLeagueQueryOptions(sportLeagueId: string) {
  return {
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
    // A league's reference data changes only when an admin edits it.
    staleTime: 5 * 60_000,
  };
}

/**
 * How a sport league's bracket rounds are named (#706): by the league's own round names where it
 * has them (the NBA's "Conference Finals"), otherwise by the sport's. An empty `sportLeagueId`
 * reads nothing. Until the league loads, and if its read fails, the rounds take the sport's
 * names, which are still correct, only less specific.
 */
export function useSportLeagueRoundLabel(sport: Sport | null | undefined, sportLeagueId: string): BracketRoundLabel {
  const sportLeagueQuery = useQuery(sportLeagueQueryOptions(sportLeagueId));
  const roundNames = sportLeagueQuery.data?.roundNames ?? [];
  // A contest with no sport has no round names to read; its rounds are numbered.
  return (roundNumber, roundCount) => (sport
    ? eventRoundLabel(sport, roundNames, roundNumber, roundCount)
    : `Round ${roundNumber}`);
}

/**
 * How a bracket contest's rounds are named, from its event's sport league (#706). Until the event
 * and its league load, the rounds take the sport's names.
 */
export function useBracketRoundLabel(sport: Sport | null | undefined, sportEventId: string): BracketRoundLabel {
  const eventQuery = useQuery(sportEventQueryOptions(sportEventId));
  return useSportLeagueRoundLabel(sport, eventQuery.data?.sportLeagueId ?? '');
}

/**
 * A knockout event's rounds by number, named as its bracket screens name them, for choosing and
 * describing where a bracket starts (#721). A null event reads nothing, and its rounds are
 * numbered.
 */
export function useEventRoundName(event: Pick<SportEventDto, 'rounds' | 'sport' | 'sportLeagueId'> | null): RoundName {
  const roundLabel = useSportLeagueRoundLabel(event?.sport, event?.sportLeagueId ?? '');
  const roundCount = event ? bracketRoundCount(event) : 0;
  return (roundNumber) => roundLabel(roundNumber, roundCount);
}

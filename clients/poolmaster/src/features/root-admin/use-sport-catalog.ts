import { eventRoundLabel, sportLeagueNounOf, type Sport, type SportNoun } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { getParticipant, listSportLeagueParticipants, listSportLeagues, listSports } from '@/lib/api';
import type { ParticipantDto, SportDto, SportEventDto, SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #236 — the Manage sport screens' reads of the shared sport catalog, in one place: a sport's
 * leagues (golf's tours), and a sport league's participants (golfers, horses). Built for
 * golf first; every sport's pages read through them since #623.
 */

/**
 * Every sport the platform runs, in its display order, with the URL segment each one's Manage
 * pages are addressed by (#2042).
 */
export function useSportsQuery() {
  return useQuery({
    queryKey: QueryKeys.sports.list,
    queryFn: async (): Promise<SportDto[]> => {
      const response = await listSports();
      if (!response.data?.sports) {
        throwApiError(response.error, 'Sport list response is missing data.');
      }
      return response.data.sports;
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** A sport's leagues; waits while no sport is given. */
export function useSportLeaguesQuery(sport: Sport | undefined) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.sportLeagues(sport),
    queryFn: async (): Promise<SportLeagueDto[]> => {
      const response = await listSportLeagues({ query: { sport } });
      if (!response.data?.sportLeagues) {
        throwApiError(response.error, 'Sport league list response is missing data.');
      }
      return response.data.sportLeagues;
    },
    enabled: sport !== undefined,
    retry: false,
  });
}

/**
 * How an event's rounds are labelled (#706): by its sport league's round names where the league
 * has them (the NBA's "Conference Finals"), otherwise by its sport's (a stat
 * pool's games). It reads the sport's
 * leagues, which the Manage screens already hold; until they load, rounds take the sport's names.
 */
export function useEventRoundLabel(event: Pick<SportEventDto, 'sport' | 'sportLeagueId'>): (roundNumber: number, roundCount: number) => string {
  const leaguesQuery = useSportLeaguesQuery(event.sport);
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const roundNames = leaguesQuery.data?.find((league) => league.id === event.sportLeagueId)?.roundNames ?? [];
  return (roundNumber, roundCount) => eventRoundLabel(event, roundNames, roundNumber, roundCount);
}

/**
 * What screens call one sport league (#834): its own noun where it has one (the NCAA's tennis
 * championships are leagues), else its sport's (the ATP is a tour). The sport's while the sport
 * leagues load, or when no sport league is in view yet.
 */
export function useSportLeagueNoun(sport: Sport, sportLeagueId: string | undefined): SportNoun {
  const leaguesQuery = useSportLeaguesQuery(sport);
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const league = leaguesQuery.data?.find((candidate) => candidate.id === sportLeagueId);
  return sportLeagueNounOf(sport, league?.noun ?? null);
}

/**
 * One sport league's participants, best rank first, unranked by name (#1853): a participant
 * belongs to one league, so this is the league's whole roster, read once and never paged; screens
 * filter it by status and name in the browser.
 */
export function useLeagueRosterQuery(sportLeagueId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueRoster(sportLeagueId),
    queryFn: async (): Promise<ParticipantDto[]> => {
      const response = await listSportLeagueParticipants({ path: { sportLeagueId } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'The roster response is missing data.');
      }
      return response.data.participants;
    },
    enabled: sportLeagueId !== '' && (options.enabled ?? true),
    retry: false,
  });
}

/** One participant, for its page and its edit page. */
export function useParticipantQuery(participantId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.participant(participantId),
    queryFn: async (): Promise<ParticipantDto> => {
      const response = await getParticipant({ path: { id: participantId } });
      if (!response.data?.participant) {
        throwApiError(response.error, 'Participant response is missing data.');
      }
      return response.data.participant;
    },
    enabled: participantId !== '',
    retry: false,
  });
}

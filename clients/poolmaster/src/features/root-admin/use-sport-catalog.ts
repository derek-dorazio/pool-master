import { eventRoundLabel, ParticipantStatus, matchPeriodsOf, sportLeagueNounOf, type Sport, type SportMatchPeriods, type SportNoun } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { getParticipant, listEventYears, listEvents, listSportLeagueParticipants, listSportLeagues } from '@/lib/api';
import type { ParticipantDto, SportEventDto, SportLeagueDto } from '@/lib/api';
import { LOADING_TEXT } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #236 — the Manage sport screens' reads of the shared sport catalog, in one place: a sport's
 * leagues (golf's tours), one sport league's events across every event year (plans/147 — the
 * event list filtered by sport league), and a sport league's participants (golfers, horses). Built for
 * golf first; every sport's pages read through them since #623.
 */

export function useSportLeaguesQuery(sport: Sport) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.sportLeagues(sport),
    queryFn: async (): Promise<SportLeagueDto[]> => {
      const response = await listSportLeagues({ query: { sport } });
      if (!response.data?.sportLeagues) {
        throwApiError(response.error, 'Sport league list response is missing data.');
      }
      return response.data.sportLeagues;
    },
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
 * The periods the event's games are played in: its sport league's own layout, else its sport's
 * (#786: men's college basketball plays halves). Undefined while the sport leagues load, and for
 * a sport whose games keep no score by period.
 */
export function useEventMatchPeriods(event: Pick<SportEventDto, 'sport' | 'sportLeagueId'>): SportMatchPeriods | undefined {
  const leaguesQuery = useSportLeaguesQuery(event.sport);
  if (!leaguesQuery.data) return undefined;
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const league = leaguesQuery.data.find((candidate) => candidate.id === event.sportLeagueId);
  return matchPeriodsOf(event.sport, league?.matchPeriodLayout ?? null);
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
 * One year of a sport league's events: what the calendar shows, not every year it has had
 * (#1251). Waits while the year is still null.
 */
export function useSportLeagueEventsQuery(sportLeagueId: string, eventYear: number | null) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueEvents(sportLeagueId, eventYear),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sportLeagueId, eventYear: eventYear ?? undefined } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Sport league event list response is missing data.');
      }
      return response.data.events;
    },
    enabled: sportLeagueId !== '' && eventYear !== null,
    retry: false,
  });
}

/** The years a sport league has events in, newest first, for the calendar's year picker. */
export function useSportLeagueEventYearsQuery(sportLeagueId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueEventYears(sportLeagueId),
    queryFn: async (): Promise<number[]> => {
      const response = await listEventYears({ query: { sportLeagueId } });
      if (!response.data?.years) {
        throwApiError(response.error, 'Sport league event years response is missing data.');
      }
      // The server lists them earliest first; the calendar's picker reads latest first.
      return [...response.data.years].sort((left, right) => right - left);
    },
    enabled: sportLeagueId !== '',
    retry: false,
  });
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

/** Who may take a place on an event's field after the draw, as `useEventLeagueCandidatesQuery` reads them. */
export interface EventLeagueCandidates {
  /** Undefined while loading. */
  data: ReadonlyArray<{ id: string; name: string }> | undefined;
  isError: boolean;
  error: Error | null;
}

/** The first option of a candidate picker: loading, or `choose`. */
export function candidatePrompt(candidates: EventLeagueCandidates, choose: string): string {
  return candidates.data ? choose : LOADING_TEXT;
}

/**
 * Who may take a place on an event's field after the draw, as a withdrawn player's replacement or
 * a play-in place's winner (#830, #1853): the active participants of its sport league, so a WTA
 * player is never offered for an ATP draw. The server refuses the same.
 */
export function useEventLeagueCandidatesQuery(event: Pick<SportEventDto, 'sportLeagueId'>): EventLeagueCandidates {
  const rosterQuery = useLeagueRosterQuery(event.sportLeagueId);
  return {
    // poolmaster-allow-list-lookup: the league's roster, read whole for the roster grid and cached; the roster read takes no status
    data: rosterQuery.data
      ?.filter((participant) => participant.status === ParticipantStatus.ACTIVE)
      .map((participant) => ({ id: participant.id, name: participant.name })),
    isError: rosterQuery.isError,
    error: rosterQuery.error,
  };
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

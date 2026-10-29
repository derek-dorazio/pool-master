import { eventRoundLabel, findSportRow, getSportDefinition, matchPeriodsOf, sportLeagueNounOf, type Sport, type SportMatchPeriods, type SportNoun } from '@poolmaster/shared/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getParticipant, listEventYears, listEvents, listParticipantLeagueAffiliations, listParticipants, listSportLeagues, listSports } from '@/lib/api';
import type { ParticipantDto, ParticipantLeagueAffiliationDto, SportEventDto, SportLeagueDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #236 — the Manage sport screens' reads of the shared sport catalog, in one place: a sport's
 * leagues (golf's tours), one sport league's events across every event year (plans/147 — the
 * event list filtered by sport league), and a sport's participants (golfers, horses). Built for
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
 * has them (the NBA's "Conference Finals"), otherwise by its sport league definition's (a stat
 * pool's games). It reads the sport's
 * leagues, which the Manage screens already hold; until they load, rounds take the sport's names.
 */
export function useEventRoundLabel(event: Pick<SportEventDto, 'sport' | 'sportLeagueId' | 'participantType' | 'scoringFamily'>): (roundNumber: number, roundCount: number) => string {
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
      return response.data.years;
    },
    enabled: sportLeagueId !== '',
    retry: false,
  });
}

function sportRowQueryOptions(sport: Sport) {
  return {
    queryKey: QueryKeys.rootAdmin.manageSport.sport(sport),
    queryFn: async () => {
      const response = await listSports();
      if (!response.data?.sports) {
        throwApiError(response.error, 'Sport list response is missing data.');
      }
      const row = findSportRow(response.data.sports, sport);
      if (!row) {
        throw new Error(`${getSportDefinition(sport).name} is not set up.`);
      }
      return row;
    },
    // The sport row does not change while the app runs.
    staleTime: Infinity,
    retry: false,
  };
}

/**
 * A sport's participants, filtered by status and a name search. The sport's id comes
 * through the query cache, so it is fetched once. The golf player list this replaces
 * defaulted to ACTIVE; `listParticipants` has no default, so callers say which status
 * they want.
 */
export function useParticipantsQuery(params: {
  sport: Sport;
  queryKey: readonly unknown[];
  status?: ParticipantDto['status'];
  q?: string;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params.queryKey,
    queryFn: async (): Promise<ParticipantDto[]> => {
      const sportRow = await queryClient.query(sportRowQueryOptions(params.sport));
      const response = await listParticipants({
        query: {
          sportId: sportRow.id,
          ...(params.status ? { status: params.status } : {}),
          ...(params.q ? { q: params.q } : {}),
        },
      });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Participant list response is missing data.');
      }
      return response.data.participants;
    },
    enabled: params.enabled ?? true,
    retry: false,
  });
}

/** One sport league's roster: its affiliations, best rank first. */
export function useLeagueRosterQuery(sportLeagueId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueRoster(sportLeagueId),
    queryFn: async (): Promise<ParticipantLeagueAffiliationDto[]> => {
      const response = await listParticipantLeagueAffiliations({ path: { sportLeagueId } });
      if (!response.data?.affiliations) {
        throwApiError(response.error, 'The roster response is missing data.');
      }
      return response.data.affiliations;
    },
    enabled: options.enabled ?? true,
    retry: false,
  });
}

/**
 * Who may take a place on an event's field after the draw, as a withdrawn player's replacement or
 * a play-in place's winner (#830): the active participants on its sport league's roster once the
 * league has one, so a WTA player is never offered for an ATP draw; otherwise every active
 * participant of the sport. The server refuses the same.
 */
export function useEventLeagueCandidatesQuery(event: Pick<SportEventDto, 'sport' | 'sportLeagueId'>): {
  data: ParticipantDto[] | undefined;
  isError: boolean;
  error: Error | null;
} {
  const sportQuery = useParticipantsQuery({
    sport: event.sport,
    status: 'ACTIVE',
    queryKey: QueryKeys.rootAdmin.manageSport.participantList(event.sport, 'ACTIVE'),
  });
  const rosterQuery = useLeagueRosterQuery(event.sportLeagueId);
  const error = sportQuery.error ?? rosterQuery.error;
  if (!sportQuery.data || !rosterQuery.data) {
    return { data: undefined, isError: error !== null, error };
  }
  const roster = new Set(rosterQuery.data.map((affiliation) => affiliation.participantId));
  return {
    data: roster.size === 0 ? sportQuery.data : sportQuery.data.filter((participant) => roster.has(participant.id)),
    isError: false,
    error: null,
  };
}

/** A sport's row, whose id a new participant of the sport is created with. */
export function useSportQuery(sport: Sport) {
  return useQuery(sportRowQueryOptions(sport));
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

import { useQuery } from '@tanstack/react-query';
import { getEvent, listEventParticipants, listEventRounds, listEventTiers } from '@/lib/api';
import type { SportEventDto, SportEventParticipantDto, SportEventRoundDto, SportEventTierDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #236 — the tournament screens' reads of one sport event: the event, its round schedule, its
 * field and its tiers. The field read carries each golfer's valuation (tier and price), standing and
 * per-round golf scores, so the tiers board and the scores page read it too rather than a
 * golf projection of their own.
 */

export function useSportEventQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.event(eventId),
    queryFn: async (): Promise<SportEventDto> => {
      const response = await getEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Golf tournament response is missing data.');
      }
      return response.data.event;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

export function useSportEventFieldQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.field(eventId),
    queryFn: async (): Promise<SportEventParticipantDto[]> => {
      const response = await listEventParticipants({ path: { eventId } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Golf tournament field response is missing data.');
      }
      return response.data.participants;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

export function useSportEventTiersQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.tiers(eventId),
    queryFn: async (): Promise<SportEventTierDto[]> => {
      const response = await listEventTiers({ path: { eventId } });
      if (!response.data?.tiers) {
        throwApiError(response.error, 'Golf tournament tiers response is missing data.');
      }
      return response.data.tiers;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

export function useSportEventRoundsQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.rounds(eventId),
    queryFn: async (): Promise<SportEventRoundDto[]> => {
      const response = await listEventRounds({ path: { eventId } });
      if (!response.data?.rounds) {
        throwApiError(response.error, 'Golf tournament rounds response is missing data.');
      }
      return response.data.rounds;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

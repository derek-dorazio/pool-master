import { useQuery } from '@tanstack/react-query';
import { getEvent, getEventBracket, listEventSlotTiebreakers, listEventTiers } from '@/lib/api';
import { sportEventRoundsQueryOptions } from '@/features/contests/use-bracket-round-label';
import type {
  SportEventDto,
  SportEventRoundMatchDto,
  SportEventSlotTiebreakerDto,
  SportEventTierDto,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { eventFieldQueryOptions } from '@/features/contests/use-event-games';

/**
 * #236 — the tournament screens' reads of one sport event: the event, its round schedule, its
 * field and its tiers. The field read carries each golfer's valuation (tier and price), standing and
 * per-round golf scores, so the tiers board and the scores page read it too rather than a
 * golf projection of their own.
 */

/**
 * The reads a change to an event's field reaches: the field, the event and its counts, the event
 * list's counts, and the tiers its participants sit in.
 */
export function fieldWriteKeys(eventId: string) {
  return [
    QueryKeys.rootAdmin.manageSport.field(eventId),
    QueryKeys.rootAdmin.manageSport.event(eventId),
    QueryKeys.rootAdmin.manageSport.events,
    QueryKeys.rootAdmin.manageSport.tiers(eventId),
  ];
}

export function useSportEventQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.event(eventId),
    queryFn: async (): Promise<SportEventDto> => {
      const response = await getEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Event response is missing data.');
      }
      return response.data.event;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

export function useSportEventFieldQuery(eventId: string) {
  // The admin pages keep the field under their own key, which their saves refresh.
  return useQuery({ ...eventFieldQueryOptions(eventId), queryKey: QueryKeys.rootAdmin.manageSport.field(eventId) });
}

export function useSportEventTiersQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.tiers(eventId),
    queryFn: async (): Promise<SportEventTierDto[]> => {
      const response = await listEventTiers({ path: { eventId } });
      if (!response.data?.tiers) {
        throwApiError(response.error, 'Event tiers response is missing data.');
      }
      return response.data.tiers;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

export function useSportEventRoundsQuery(eventId: string) {
  return useQuery(sportEventRoundsQueryOptions(eventId));
}

/** Each slot's tiebreaker game and the Games it could be (#2048), for the Slots tab's dialog. */
export function useSportEventSlotTiebreakersQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.slotTiebreakers(eventId),
    queryFn: async (): Promise<SportEventSlotTiebreakerDto[]> => {
      const response = await listEventSlotTiebreakers({ path: { eventId } });
      if (!response.data?.slots) {
        throwApiError(response.error, 'Slot tiebreakers response is missing data.');
      }
      return response.data.slots;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

/** A bracket event's matches in match-number order (#698); empty until its bracket is loaded. */
export function useSportEventBracketQuery(eventId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.bracket(eventId),
    queryFn: async (): Promise<SportEventRoundMatchDto[]> => {
      const response = await getEventBracket({ path: { eventId } });
      if (!response.data?.matches) {
        throwApiError(response.error, 'Event bracket response is missing data.');
      }
      return response.data.matches;
    },
    enabled: eventId !== '',
    retry: false,
  });
}

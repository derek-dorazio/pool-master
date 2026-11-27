import { useQuery } from '@tanstack/react-query';
import { getEvent, getEventBracket, listEventSlotParticipants, listEventSlotTiebreakers, listEventSlotTiers } from '@/lib/api';
import { sportEventRoundsQueryOptions } from '@/features/contests/use-bracket-round-label';
import type {
  SportEventDto,
  SportEventParticipantDto,
  SportEventRoundMatchDto,
  SportEventSlotTiebreakerDto,
  SportEventTierDto,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { eventFieldQueryOptions } from '@/features/contests/use-event-games';

/**
 * #236 — the tournament screens' reads of one sport event: the event, its round schedule, its
 * field and each slot's tier set (#2044). The field read carries each golfer's valuation (tier and price), standing and
 * per-round golf scores, so the tiers board and the scores page read it too rather than a
 * golf projection of their own.
 */

/**
 * The reads a change to an event's field reaches: the field (every slot's), the event and its
 * counts, the event list's counts, and every slot's tiers its participants sit in (#2044).
 */
export function fieldWriteKeys(eventId: string) {
  return [
    QueryKeys.rootAdmin.manageSport.field(eventId),
    QueryKeys.rootAdmin.manageSport.event(eventId),
    QueryKeys.rootAdmin.manageSport.events,
    QueryKeys.rootAdmin.manageSport.tierSets(eventId),
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

/** One slot's field (#2044): its rows with that slot's tiers and prices. */
export function useSportEventSlotFieldQuery(eventId: string, seasonSlotId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.slotField(eventId, seasonSlotId),
    queryFn: async (): Promise<SportEventParticipantDto[]> => {
      const response = await listEventSlotParticipants({ path: { eventId, seasonSlotId } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Slot field response is missing data.');
      }
      return response.data.participants;
    },
    enabled: eventId !== '' && seasonSlotId !== '',
    retry: false,
  });
}

/** One slot's tiers (#2044), in tier order. */
export function useSportEventSlotTiersQuery(eventId: string, seasonSlotId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.slotTiers(eventId, seasonSlotId),
    queryFn: async (): Promise<SportEventTierDto[]> => {
      const response = await listEventSlotTiers({ path: { eventId, seasonSlotId } });
      if (!response.data?.tiers) {
        throwApiError(response.error, 'Slot tiers response is missing data.');
      }
      return response.data.tiers;
    },
    enabled: eventId !== '' && seasonSlotId !== '',
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

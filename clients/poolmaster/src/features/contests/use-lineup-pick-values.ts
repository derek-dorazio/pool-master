import { useQuery } from '@tanstack/react-query';
import { SelectionType } from '@poolmaster/shared/domain';
import {
  listEventTiers,
  type ContestDto,
  type ContestEntryParticipantDetailDto,
  type SportEventTierDto,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { sportEventQueryOptions } from './use-contest-schedule';
import { eventFieldQueryOptions } from './use-event-games';

/**
 * What a lineup pick shows beside its name on the contest page (#1740), by how the contest is
 * picked: a tiered pick its tier, a budget pick its price, and a random draw's nothing, since the
 * draw dealt it. Picks are pointers into the event's field, so the values are the field's own.
 */
export type LineupPickValues =
  | { kind: 'tier'; tierNumberByFieldRowId: ReadonlyMap<string, number> }
  | { kind: 'price'; priceByFieldRowId: ReadonlyMap<string, number>; salaryCap: number | null }
  | { kind: 'none' };

const SHARED_EVENT_READ = { retry: false, staleTime: 5 * 60_000 } as const;

function useEventFieldQuery(sportEventId: string, enabled: boolean) {
  return useQuery({
    ...eventFieldQueryOptions(sportEventId),
    ...SHARED_EVENT_READ,
    enabled: enabled && sportEventId !== '',
  });
}

function useEventTiersQuery(sportEventId: string, enabled: boolean) {
  return useQuery({
    ...SHARED_EVENT_READ,
    queryKey: QueryKeys.sportEvents.tiers(sportEventId),
    queryFn: async (): Promise<SportEventTierDto[]> => {
      const response = await listEventTiers({ path: { eventId: sportEventId } });
      if (!response.data?.tiers) {
        throwApiError(response.error, 'Event tiers response is missing data.');
      }
      return response.data.tiers;
    },
    enabled: enabled && sportEventId !== '',
  });
}

/**
 * The values a lineup contest's picks show for one of its events, read only while `enabled` (the
 * viewer has a lineup to show). Undefined until the reads it needs have answered; a failed read
 * leaves the values off rather than holding the picks back.
 */
export function useLineupPickValues(
  selectionType: ContestDto['selectionType'] | undefined,
  sportEventId: string,
  enabled: boolean,
): LineupPickValues | undefined {
  const isTiered = selectionType === SelectionType.TIERED;
  const isBudget = selectionType === SelectionType.BUDGET_PICK;
  const fieldQuery = useEventFieldQuery(sportEventId, enabled && (isTiered || isBudget));
  const tiersQuery = useEventTiersQuery(sportEventId, enabled && isTiered);
  const eventQuery = useQuery({ ...sportEventQueryOptions(sportEventId), enabled: enabled && isBudget && sportEventId !== '' });

  if (!selectionType) {
    return undefined;
  }
  if (!isTiered && !isBudget) {
    return { kind: 'none' };
  }
  const field = fieldQuery.data;
  if (fieldQuery.isError) {
    return { kind: 'none' };
  }
  if (isTiered) {
    if (tiersQuery.isError) {
      return { kind: 'none' };
    }
    if (!field || !tiersQuery.data) {
      return undefined;
    }
    const tierNumberById = new Map(tiersQuery.data.map((tier) => [tier.id, tier.tierNumber]));
    const tierNumberByFieldRowId = new Map<string, number>();
    for (const row of field) {
      const tierNumber = row.valuation?.sportEventTierId ? tierNumberById.get(row.valuation.sportEventTierId) : undefined;
      if (tierNumber !== undefined) {
        tierNumberByFieldRowId.set(row.id, tierNumber);
      }
    }
    return { kind: 'tier', tierNumberByFieldRowId };
  }
  if (!field || (!eventQuery.data && !eventQuery.isError)) {
    return undefined;
  }
  const priceByFieldRowId = new Map<string, number>();
  for (const row of field) {
    if (row.valuation?.price !== null && row.valuation?.price !== undefined) {
      priceByFieldRowId.set(row.id, row.valuation.price);
    }
  }
  return { kind: 'price', priceByFieldRowId, salaryCap: eventQuery.data?.pricing?.salaryCap ?? null };
}

/** A budget lineup's spend: the prices of its picks in the event, or null where the contest is not a budget one. */
export function lineupSpend(
  picks: readonly Pick<ContestEntryParticipantDetailDto, 'sportEventParticipantId'>[],
  values: LineupPickValues | undefined,
): { spent: number; salaryCap: number | null } | null {
  if (values?.kind !== 'price') {
    return null;
  }
  const spent = picks.reduce((sum, pick) => sum + (values.priceByFieldRowId.get(pick.sportEventParticipantId) ?? 0), 0);
  return { spent, salaryCap: values.salaryCap };
}

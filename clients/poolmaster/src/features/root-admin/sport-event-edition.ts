import type { SportLeagueSeasonDto, SportLeagueSeasonPhaseSlotDto } from '@/lib/api';

/**
 * The tour a new event is created into (#2003: in its current Season, which the API sets), shared
 * by both creation modes.
 *
 * Split out of `sport-event-edition-fields.tsx` for
 * `react-refresh/only-export-components` (#345 Phase 0, from #167): that module exports the
 * fields component, so the helper beside it broke Fast Refresh for it.
 */

/** The tour a new event is created into, as the create page holds it. */
export interface SportEventEdition {
  sportLeagueId: string;
}

export function isCompleteEdition(edition: SportEventEdition): boolean {
  return edition.sportLeagueId !== '';
}

/** The current Season's test slots that no event covers yet, in the Season's play order. */
export function freeTestSlotsOf(seasons: readonly SportLeagueSeasonDto[]): SportLeagueSeasonPhaseSlotDto[] {
  const current = seasons.find((season) => season.isCurrent);
  return (current?.phases ?? []).flatMap((phase) => phase.slots).filter((slot) => slot.isTestData && slot.sportEventId === null);
}

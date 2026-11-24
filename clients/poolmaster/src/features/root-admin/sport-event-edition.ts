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

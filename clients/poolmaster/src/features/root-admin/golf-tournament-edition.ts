/**
 * The tour and event year a golf tournament is created into, and the parsing its
 * two forms share.
 *
 * Split out of `golf-tournament-edition-fields.tsx` for
 * `react-refresh/only-export-components` (#345 Phase 0, from #167): that module
 * exports the fields component, so these two functions beside it broke Fast
 * Refresh for it. The type moved with them, since both consumers
 * (`golf-tournament-manual-create-form.tsx`,
 * `golf-tournament-provider-browse.tsx`) want the type and the parsers together.
 */

/** The tour and event year a new tournament is created into, as the create page holds them. */
export interface GolfTournamentEdition {
  sportLeagueId: string;
  /** The year as typed; `parseEventYear` turns it into the contract's integer. */
  eventYear: string;
}

/** A four-digit year, or null while the input does not hold one. */
export function parseEventYear(value: string): number | null {
  return /^\d{4}$/.test(value.trim()) ? Number.parseInt(value.trim(), 10) : null;
}

export function isCompleteEdition(edition: GolfTournamentEdition): boolean {
  return edition.sportLeagueId !== '' && parseEventYear(edition.eventYear) !== null;
}

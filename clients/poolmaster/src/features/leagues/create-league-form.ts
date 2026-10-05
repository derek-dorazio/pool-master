/**
 * Pure helpers for the create-league form.
 *
 * Split out of `create-league-modal.tsx` for
 * `react-refresh/only-export-components` (#345 Phase 0, from #167): the modal is
 * a component, so these two exported functions beside it broke Fast Refresh for
 * it.
 */
import { buildLeaguePath } from "./league-routing";

/** A league code suggested from the league's name: A-Z0-9 only, 16 chars max. */
export function suggestLeagueCode(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

export function buildCreateLeagueDestination(leagueCode: string) {
  return buildLeaguePath(leagueCode);
}

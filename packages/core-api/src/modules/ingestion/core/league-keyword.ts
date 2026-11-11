/**
 * Whether a provider's tour name (`metadata.tour` on an event or a participant) names the sport
 * league whose match keyword this is (#385): equal, ignoring case and surrounding space. Exact,
 * so "PGA TOUR" never matches "LPGA Tour". A league with no keyword is named by no tour.
 */
export function isLeagueTour(tour: string, keyword: string | null): boolean {
  return keyword !== null && tour.trim().toLowerCase() === keyword.trim().toLowerCase();
}

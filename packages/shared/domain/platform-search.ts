/**
 * The platform-wide lists a root admin searches (every user, every league, a sport's whole
 * participant catalog) need a search term before they read anything (#1180): they are the
 * largest tables, and nothing pages them (§16). Three characters, because the trigram indexes
 * that serve the substring search need at least one whole trigram to narrow anything.
 */
export const PLATFORM_SEARCH_MIN_LENGTH = 3;

/**
 * Whether `term`, trimmed, is long enough to search a platform-wide list. A plain boolean, not a
 * type guard: a short term is still a string. Callers trim the term they search with.
 */
export function isPlatformSearchTerm(term: string | undefined): boolean {
  return (term?.trim().length ?? 0) >= PLATFORM_SEARCH_MIN_LENGTH;
}

/**
 * `term` trimmed, when it is long enough to search a platform-wide list, else null. For the
 * server, which searches with the term it checks (#1313).
 */
export function platformSearchTerm(term: string | undefined): string | null {
  return isPlatformSearchTerm(term) ? (term as string).trim() : null;
}

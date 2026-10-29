/**
 * The platform-wide lists a root admin searches (every user, every league, a sport's whole
 * participant catalog) need a search term before they read anything (#1180): they are the
 * largest tables, and nothing pages them (§16). Three characters, because the trigram indexes
 * that serve the substring search need at least one whole trigram to narrow anything.
 */
export const PLATFORM_SEARCH_MIN_LENGTH = 3;

/** Whether `term`, trimmed, is long enough to search a platform-wide list. */
export function isPlatformSearchTerm(term: string | undefined): term is string {
  return (term?.trim().length ?? 0) >= PLATFORM_SEARCH_MIN_LENGTH;
}

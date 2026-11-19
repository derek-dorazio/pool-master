/**
 * The platform-wide participant catalog a root admin searches needs a search term (or a sport
 * league) before it reads anything (#1180): it is a large table, and nothing pages it (§16).
 * Three characters, because the trigram indexes that serve the substring search need at least
 * one whole trigram to narrow anything.
 */
export const PLATFORM_SEARCH_MIN_LENGTH = 3;

/** Whether `term`, trimmed, is long enough to search a platform-wide list. */
export function isPlatformSearchTerm(term: string | undefined): boolean {
  return (term?.trim() ?? '').length >= PLATFORM_SEARCH_MIN_LENGTH;
}

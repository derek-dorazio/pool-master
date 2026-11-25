/**
 * A URL segment (#2042): how a sport, a sport league or an event page is named in addresses, such
 * as `american-football`, `wnba` or `championship-weekend`. Lower case letters and digits, in
 * words joined by single dashes. Each is a stored column, never built from a name or a code, and
 * the tables check this same pattern.
 */
export const URL_SEGMENT_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isUrlSegment(value: string): boolean {
  return URL_SEGMENT_PATTERN.test(value);
}

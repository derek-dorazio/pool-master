/**
 * #1243 — app queries that read a growing table whole on purpose. Read by `index-check.ts`.
 *
 * An entry covers a statement on `table` whose shape (its SQL, placeholders written `$?`)
 * contains `sqlIncludes`; take the narrowest fragment that names the statement, usually its
 * filter. `reason` says why no index should serve it, or names the ticket that will add one. A fix
 * PR deletes its entry.
 */
export interface TableScanAllowance {
  table: string;
  sqlIncludes: string;
  reason: string;
}

export const TABLE_SCAN_ALLOWANCES: readonly TableScanAllowance[] = [
  {
    table: 'leagues',
    sqlIncludes: 'FROM "public"."leagues" WHERE "public"."leagues"."is_active" = $? ORDER BY',
    reason: 'The commissioner notices email every active league, so they read every active league; no screen calls it (#1313). #1303 covers the sweep.',
  },
];

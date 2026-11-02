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
    table: 'sport_events',
    sqlIncludes: 'FROM "public"."sport_events" WHERE "public"."sport_events"."event_year" = $? ORDER BY',
    reason: "The root admin Events page lists one year's events across every sport; no index leads on event_year yet. "
      + '#1377 adds one. The contract test sends it as a root admin (#1348).',
  },
  {
    table: 'leagues',
    sqlIncludes: 'FROM "public"."leagues" WHERE "public"."leagues"."is_active" = $? ORDER BY',
    reason: 'The commissioner notices tell every active league of a due event, so they read every active league, and only when an event email is due; '
      + 'no screen calls it (#1313). The lifecycle sweep test sends it (#1303).',
  },
  {
    table: 'contest_sport_events',
    sqlIncludes: 'NOT ("public"."contests"."status" = CAST($?::text AS "public"."PrismaContestStatus") AND (EXISTS(SELECT "t0"."contest_id" FROM "public"."contest_sport_events"',
    reason: "A league's current contests leave out a draft whose event has started. The generic plan on the tests' near-empty tables hashes that EXISTS over every row; "
      + 'the real plan checks each of the league\'s contests through contest_sport_events_contest_id_sport_event_id_key, and costs far less, so Postgres keeps it (checked on 50k contests, #1302).',
  },
  {
    table: 'contest_entries',
    sqlIncludes: 'SET "last_standings_email_position" = placed.position',
    reason: "A standings email records each placed entry's position by id. On the tests' near-empty table the plan hashes the ids against every entry; "
      + 'the real plan looks up each id through contest_entries_pkey, so Postgres keeps it (checked on 200k entries, #1302).',
  },
];

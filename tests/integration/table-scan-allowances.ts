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
    reason: 'The commissioner notices tell every active league of a due event, so they read every active league, and only when an event email is due; '
      + 'no screen calls it (#1313). The lifecycle sweep test sends it (#1303).',
  },
  {
    table: 'leagues',
    sqlIncludes: 'SET muted_sport_league_ids = array_remove(muted_sport_league_ids, $?::uuid) WHERE $?::uuid = ANY(muted_sport_league_ids)',
    reason: "Deleting a sport league (#1400) takes it out of every league's muted list, which has no foreign key or index. It runs only when a root admin or the "
      + 'nightly QA e2e sweep deletes a tour nothing uses, so a GIN index every league write would pay for is not worth it.',
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
  {
    table: 'sport_events',
    sqlIncludes: 'FROM "public"."sport_events" WHERE 1=1 GROUP BY "public"."sport_events"."sport_league_season_id"',
    reason: "The root admin's Sports page (#1847) counts every sport league's events, so it groups every event: one row per Season (#2004), a few thousand "
      + 'events in all. Only that page reads it, and an index cannot narrow a read of every row. (Its seasons are the current Season\'s own span since #2003.)',
  },
  {
    table: 'sport_league_seasons',
    sqlIncludes: 'SELECT "public"."sport_league_seasons"."id", "public"."sport_league_seasons"."sport_league_id" FROM "public"."sport_league_seasons" WHERE 1=1',
    reason: "The root admin's Sports page (#1847) names the league of every Season its event counts are grouped by (#2004): a few Seasons per league, "
      + 'a few hundred rows in all, read whole once for the page. An index cannot narrow a read of every row.',
  },
  {
    table: 'leagues',
    sqlIncludes: 'FROM "public"."leagues" WHERE 1=1 ORDER BY "public"."leagues"."name" ASC, "public"."leagues"."league_code" ASC',
    reason: "The root admin's Customers › Leagues grid (#1882) loads every league and filters on the client: no paging or server search in root admin "
      + '(Derek, 2026-11-18). Only that page reads it, and an index cannot narrow a read of every row.',
  },
  {
    table: 'users',
    sqlIncludes: 'FROM "public"."users" WHERE 1=1 ORDER BY "public"."users"."last_name" ASC, "public"."users"."first_name" ASC',
    reason: "The root admin's Customers › Users grid (#1882) loads every user and filters on the client: no paging or server search in root admin "
      + '(Derek, 2026-11-18). Only that page reads it, and an index cannot narrow a read of every row.',
  },
  {
    table: 'provider_sync_findings',
    sqlIncludes: 'FROM "public"."provider_sync_findings" WHERE 1=1 ORDER BY "public"."provider_sync_findings"."last_seen_at" DESC',
    reason: "The root admin's Findings grid (#1999) loads every finding and filters on the client: no paging or server search in root admin "
      + '(Derek, 2026-11-18). Resolved findings are deleted after 90 days, so the table stays small; an index cannot narrow a read of every row.',
  },
];

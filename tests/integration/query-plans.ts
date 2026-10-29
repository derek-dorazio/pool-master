/**
 * #1243 — every query the integration run sends to a table that grows with customer data can use
 * an index.
 *
 * Test data is a handful of rows, where a table scan is as fast as an index lookup, so timing
 * never noticed a missing index. Postgres's plan does: with sequential scans priced out of reach
 * (`enable_seqscan = off`), it still picks one only when no index can serve the query. The check
 * asks for the generic plan, the one a prepared statement gets whatever its parameters, so no
 * parameter value can hide or invent a miss.
 *
 * `helpers.ts` hands every query event to `queryPlanLog`, and `teardownIntegrationTests` asks for
 * the plans of what the suite sent and fails it on a scan `SEQ_SCAN_ALLOW_LIST` does not name.
 * Test code's own queries (cleanup by a test prefix, a read of every row to assert on) run in
 * `outsideQueryPlanCheck` and are not logged.
 * The foreign key indexes themselves are `database-indexes.integration.ts`; this covers every
 * other `where` and `orderBy`.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { reportedSoFar, statementShape } from './statement-log';
import { SEQ_SCAN_ALLOW_LIST, type SeqScanAllowance } from './seq-scan-allow-list';

/**
 * The tables whose row count grows with customers, seasons or time. A scan of anything else
 * (sports, sport leagues, setups, event pages, settings) reads a short list the root admin keeps.
 */
export const GROWING_TABLES = [
  'users',
  'refresh_tokens',
  'password_reset_tokens',
  'email_change_undo_tokens',
  'leagues',
  'league_payments',
  'contest_expansions',
  'league_plan_changes',
  'league_plan_renewal_changes',
  'league_memberships',
  'squads',
  'squad_memberships',
  'league_invitations',
  'squad_owner_invitations',
  'email_messages',
  'email_suppressions',
  'email_opt_outs',
  'participants',
  'participant_league_affiliations',
  'participant_provider_mappings',
  'contests',
  'contest_sport_events',
  'contest_configurations',
  'participant_contest_scoring_rules',
  'contest_prize_definitions',
  'contest_entries',
  'contest_entry_events',
  'contest_entry_match_predictions',
  'contest_entry_standings',
  'contest_entry_event_standings',
  'contest_entry_picks',
  'contest_draws',
  'contest_squares_games',
  'contest_entry_squares',
  'contest_squares_draws',
  'contest_squares_winners',
  'cups',
  'cup_standings',
  'league_year_finishes',
  'league_year_reviews',
  'sport_events',
  'sport_event_participants',
  'sport_event_rounds',
  'sport_event_matches',
  'sport_event_match_period_scores',
  'sport_event_participant_rounds',
  'sport_event_participant_golf_rounds',
  'sport_event_participant_stat_lines',
  'sport_event_participant_standings',
  'sport_event_participant_golf_standings',
  'sport_event_participant_race_results',
  'sport_event_tiers',
  'sport_event_participant_valuations',
  'provider_sync_runs',
] as const;

export type GrowingTable = (typeof GROWING_TABLES)[number];

const GROWING = new Set<string>(GROWING_TABLES);

function isGrowingTable(table: string): table is GrowingTable {
  return GROWING.has(table);
}

/** One query shape the suite sent, with the first parameters and test it was seen with. */
export interface LoggedQuery {
  sql: string;
  params: string;
  test: string;
}

/** A table scan the plan of a logged query needs, named as the allow-list names it. */
export interface UnindexedScan {
  table: GrowingTable;
  /** The scan's filter as the plan prints it, placeholders written `$?`; null when it reads every row. */
  filter: string | null;
  query: LoggedQuery;
}

/** Only these read rows by a condition; an INSERT or a transaction statement has no plan to check. */
const PLANNED_STATEMENT = /^\s*(SELECT|UPDATE|DELETE|WITH)\b/i;

/**
 * Prisma's query builder names every table with its schema. A statement without one is raw SQL:
 * a migration test's backfill, a test reading the catalog, or one of the app's few lock statements.
 */
const BUILT_BY_PRISMA = '"public".';

/** Whether `sql` is `deleteMany({})`, which only test cleanup sends: the app never empties a table. */
function deletesEveryRow(sql: string): boolean {
  return sql.startsWith('DELETE ') && sql.endsWith(' WHERE 1=1');
}

/** Whether the check reads this statement's plan. */
function isCheckedStatement(sql: string): boolean {
  return PLANNED_STATEMENT.test(sql) && sql.includes(BUILT_BY_PRISMA) && !deletesEveryRow(sql);
}

const loggedQueries = new Map<string, LoggedQuery>();
/** How many `outside` calls are running; while any is, nothing is logged. */
let outsideDepth = 0;

/** Who is running now, to name in a failure; outside a test it is the suite's own setup. */
function currentTestName(): string {
  return expect.getState().currentTestName ?? '(suite setup or teardown)';
}

export const queryPlanLog = {
  /** Wired to the integration client's `$on('query')`: keeps the first of each shape. */
  receive(event: Prisma.QueryEvent): void {
    if (outsideDepth > 0 || !isCheckedStatement(event.query)) return;
    const shape = statementShape(event.query);
    if (loggedQueries.has(shape)) return;
    loggedQueries.set(shape, { sql: event.query, params: event.params, test: currentTestName() });
  },
  /**
   * Runs test code whose own queries are not the app's: cleanup by code prefix, a read of every
   * row to assert on. Each edge waits for the statements sent before it, as `recordStatements`
   * does, so the app's statements on either side are still logged and the work's are not.
   */
  async outside<Result>(prisma: PrismaClient, work: () => Promise<Result>): Promise<Result> {
    await reportedSoFar(prisma);
    outsideDepth += 1;
    try {
      return await work();
    } finally {
      await reportedSoFar(prisma);
      outsideDepth -= 1;
    }
  },
  /** The shapes logged since the last `take`, and forgets them. */
  take(): LoggedQuery[] {
    const queries = [...loggedQueries.values()];
    loggedQueries.clear();
    return queries;
  },
};

/** The part of an `EXPLAIN (FORMAT JSON)` plan node the check reads. */
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Filter?: string;
  Plans?: PlanNode[];
}

/** A plan filter with its placeholders written `$?` and each `ANY (ARRAY[...])` list as one, as `statementShape` does for SQL. */
function filterShape(filter: string): string {
  return filter.replace(/\$\d+/g, '$?').replace(/ARRAY\[(?:\$\?, )*\$\?\]/g, 'ARRAY[$?...]');
}

function* seqScans(node: PlanNode): Generator<PlanNode> {
  if (node['Node Type'] === 'Seq Scan') yield node;
  for (const child of node.Plans ?? []) yield* seqScans(child);
}

/**
 * Asks for a statement's generic plan with sequential scans priced out. The statement travels as
 * a text argument: sent as itself, Prisma would want a value for each of its `$n` placeholders,
 * and a generic plan takes none. The function lives in the connection's temporary schema, so
 * each check (re)creates it on the connection its transaction runs on.
 */
const GENERIC_PLAN_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.generic_plan(statement text) RETURNS json LANGUAGE plpgsql AS $fn$
  DECLARE plan json;
  BEGIN
    SET LOCAL enable_seqscan = off;
    EXECUTE 'EXPLAIN (GENERIC_PLAN, FORMAT JSON) ' || statement INTO plan;
    RETURN plan;
  END $fn$`;

/** Generous: a suite sends a few hundred shapes, each planned in about a millisecond. */
const PLAN_TRANSACTION_TIMEOUT_MS = 60_000;

/** Each query with its generic plan, read in one transaction. */
async function genericPlans(prisma: PrismaClient, queries: readonly LoggedQuery[]): Promise<Array<{ query: LoggedQuery; plan: PlanNode }>> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(GENERIC_PLAN_FUNCTION);
    const planned: Array<{ query: LoggedQuery; plan: PlanNode }> = [];
    for (const query of queries) {
      const [row] = await tx.$queryRaw<[{ plan: [{ Plan: PlanNode }] }]>`SELECT pg_temp.generic_plan(${query.sql}) AS plan`;
      planned.push({ query, plan: row.plan[0].Plan });
    }
    return planned;
  }, { timeout: PLAN_TRANSACTION_TIMEOUT_MS });
}

/** The scans of a growing table that the plans of `queries` need. */
export async function findUnindexedScans(prisma: PrismaClient, queries: readonly LoggedQuery[]): Promise<UnindexedScan[]> {
  if (queries.length === 0) return [];
  const scans: UnindexedScan[] = [];
  for (const { query, plan } of await genericPlans(prisma, queries)) {
    for (const scan of seqScans(plan)) {
      const table = scan['Relation Name'];
      if (!table || !isGrowingTable(table)) continue;
      scans.push({ table, filter: scan.Filter === undefined ? null : filterShape(scan.Filter), query });
    }
  }
  return scans;
}

/** The allowance that covers `scan`, if any. */
export function allowanceFor(
  scan: Pick<UnindexedScan, 'table' | 'filter'>,
  allowList: readonly SeqScanAllowance[] = SEQ_SCAN_ALLOW_LIST,
): SeqScanAllowance | undefined {
  return allowList.find((allowance) => allowance.table === scan.table && allowance.filter === scan.filter);
}

/** How a scan reads in the allow-list and in a failure. */
export function describeScan(scan: Pick<UnindexedScan, 'table' | 'filter'>): string {
  return scan.filter === null ? `${scan.table}, every row` : `${scan.table} filtered by ${scan.filter}`;
}

/** Fails with each scan of what the suite sent that the allow-list does not name. */
export async function expectEveryQueryIndexed(prisma: PrismaClient): Promise<void> {
  const scans = await findUnindexedScans(prisma, queryPlanLog.take());
  const unallowed = scans.filter((scan) => !allowanceFor(scan));
  if (unallowed.length === 0) return;
  const report = unallowed
    .map((scan) => `- ${describeScan(scan)}\n  test: ${scan.query.test}\n  sql: ${scan.query.sql}\n  params: ${scan.query.params}`)
    .join('\n');
  throw new Error(
    `${unallowed.length} quer${unallowed.length === 1 ? 'y' : 'ies'} would scan a table that grows with customer data, `
      + 'because no index serves the filter. Add an @@index the read can use (rules/model-change-rules.md '
      + '*Indexes Follow The Reads And The Foreign Keys*), or, for a deliberate scan, an entry with its reason in '
      + 'tests/integration/seq-scan-allow-list.ts. A query of test code\'s own, never the app\'s, goes in '
      + `outsideQueryPlanCheck.\n${report}`,
  );
}

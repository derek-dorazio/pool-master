/**
 * #1243 — an app query on a growing table that no index can serve fails the integration run.
 *
 * With test data a table scan is as fast as an index lookup, so a missing index never shows in a
 * timing. Postgres's plan does: with `enable_seqscan = off` the planner still picks a sequential
 * scan only when no index can serve the filter. `database-indexes.integration.ts` covers foreign
 * keys; this covers every other `where` and `orderBy` the app sends.
 *
 * How it works. The integration app runs on a Prisma client of its own, and every statement it
 * sends reaches `indexCheck.receive`; the tests' seeds, reads and cleanup use another client, so
 * they are never planned. When a test file ends, `describeUnindexedScans` plans each distinct
 * statement generically (`plan_cache_mode = force_generic_plan`, so no bound value shapes the
 * plan) and reports a whole read of a growing table that `TABLE_SCAN_ALLOWANCES` does not list.
 *
 * Raw SQL lives here only, to ask Postgres for plans (Derek 2026-10-29: none in application code).
 */
import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { statementShape } from './statement-log';
import { TABLE_SCAN_ALLOWANCES, type TableScanAllowance } from './table-scan-allowances';

/**
 * Tables that grow with customer data or with each season's sport data. Every other table is
 * reference data a migration or a root admin writes a handful of rows into: sports, sport leagues,
 * event series, setups, event pages, app settings.
 */
export const GROWING_TABLES = new Set([
  'users', 'refresh_tokens', 'password_reset_tokens', 'email_change_undo_tokens',
  'leagues', 'league_payments', 'contest_expansions', 'league_plan_changes', 'league_plan_renewal_changes',
  'league_memberships', 'squads', 'squad_memberships', 'league_invitations', 'squad_owner_invitations',
  'email_messages', 'email_suppressions', 'email_opt_outs',
  'contests', 'cups', 'cup_standings', 'league_year_finishes', 'league_year_reviews', 'contest_sport_events',
  'contest_configurations', 'participant_contest_scoring_rules', 'contest_prize_definitions',
  'contest_entries', 'contest_entry_events', 'contest_entry_match_predictions', 'contest_entry_standings',
  'contest_entry_event_standings', 'contest_entry_picks', 'contest_draws', 'contest_squares_games',
  'contest_entry_squares', 'contest_squares_draws', 'contest_squares_winners',
  'participants', 'participant_league_affiliations', 'participant_provider_mappings',
  'sport_events', 'sport_event_participants', 'sport_event_rounds', 'sport_event_matches',
  'sport_event_match_period_scores', 'sport_event_participant_rounds', 'sport_event_participant_golf_rounds',
  'sport_event_participant_stat_lines', 'sport_event_participant_standings', 'sport_event_participant_golf_standings',
  'sport_event_participant_race_results', 'sport_event_tiers', 'sport_event_participant_valuations',
  'provider_sync_runs',
]);

/** An app statement as the check keeps it: its SQL and the first test that sent it. */
export interface Statement {
  sql: string;
  test: string;
}

/** A whole-table read the check found: where, how, and the first test that sent the statement. */
export interface ScanFinding {
  table: string;
  how: string;
  sql: string;
  test: string;
}

/** The app's statements in this file, first sending test kept, one per shape. */
const statements = new Map<string, Statement>();

export const indexCheck = {
  /** Wired to the app client's `$on('query')`. */
  receive(event: Prisma.QueryEvent): void {
    if (!/^\s*(SELECT|UPDATE|DELETE|WITH)\b/i.test(event.query)) return;
    const shape = statementShape(event.query);
    if (!statements.has(shape)) statements.set(shape, { sql: event.query, test: expect.getState().currentTestName ?? '(a hook)' });
  },
};

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Alias?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Join Filter'?: string;
  'Hash Cond'?: string;
  'Merge Cond'?: string;
  Plans?: PlanNode[];
}

/** An index's table and the column it leads on, null when it leads on an expression. */
interface IndexLead {
  table: string;
  column: string | null;
}

/** A read of a whole table in one plan: the table and how the plan reads it. */
export interface WholeScan {
  table: string;
  how: string;
}

const INDEX_NODES = new Set(['Index Scan', 'Index Only Scan', 'Bitmap Index Scan']);

/** Every index in the schema, by name. */
export async function readIndexLeads(prisma: PrismaClient): Promise<Map<string, IndexLead>> {
  const rows = await prisma.$queryRaw<Array<{ index_name: string; table_name: string; column_name: string | null }>>`
    SELECT index_class.relname AS index_name, table_class.relname AS table_name, lead_column.attname AS column_name
    FROM pg_index
    JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
    JOIN pg_class table_class ON table_class.oid = pg_index.indrelid
    JOIN pg_namespace ON pg_namespace.oid = table_class.relnamespace AND pg_namespace.nspname = 'public'
    LEFT JOIN pg_attribute lead_column ON lead_column.attrelid = pg_index.indrelid AND lead_column.attnum = pg_index.indkey[0]`;
  return new Map(rows.map((row) => [row.index_name, { table: row.table_name, column: row.column_name }]));
}

/** Whether an index condition constrains `column`: Postgres prints the indexed column first. */
function constrains(condition: string, column: string): boolean {
  return new RegExp(`\\(\\s*"?${column}"?\\b`).test(condition);
}

/** Whether `text`, a plan node's condition or filter, names `column` of the node's own table. */
function namesColumn(text: string, column: string, alias: string | undefined): boolean {
  const own = alias === undefined ? '' : `|\\b${alias}\\.`;
  return new RegExp(`(?:(?<![\\w.])${own})"?${column}"?\\b`).test(text);
}

/**
 * Whether some index on `table` leads on a column the node filters or is joined by. On a table of
 * a few test rows the planner may walk one index for its order and filter, use a later column of
 * another, or join with a filter instead of looking rows up, rather than use the index that serves
 * the read; that index exists, so nothing is missing.
 */
function someIndexLeadsOnFilter(node: PlanNode, table: string, indexes: Map<string, IndexLead>, joins: string): boolean {
  const text = `${node['Index Cond'] ?? ''} ${node.Filter ?? ''} ${joins}`;
  return [...indexes.values()].some((index) => index.table === table && index.column !== null && namesColumn(text, index.column, node.Alias));
}

/**
 * The whole-table reads in a plan. With sequential scans off the planner still reads a table
 * whole when no index serves its filter, in one of three ways: a sequential scan; walking an index
 * by a condition on a column it does not lead on; or walking an index for its order and filtering
 * every row.
 */
function wholeScans(node: PlanNode, indexes: Map<string, IndexLead>, into: WholeScan[], joins = ''): WholeScan[] {
  const index = node['Index Name'] === undefined ? undefined : indexes.get(node['Index Name']);
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) {
    into.push({ table: node['Relation Name'], how: 'a sequential scan' });
  } else if (INDEX_NODES.has(node['Node Type']) && index && !someIndexLeadsOnFilter(node, index.table, indexes, joins)) {
    const condition = node['Index Cond'];
    if (condition === undefined && node.Filter !== undefined) {
      into.push({ table: index.table, how: `walking every entry of ${String(node['Index Name'])} and filtering` });
    } else if (condition !== undefined && index.column !== null && !constrains(condition, index.column)) {
      into.push({ table: index.table, how: `walking all of ${String(node['Index Name'])}, which leads on ${index.column}` });
    }
  }
  // A join's conditions name the columns its inner side is looked up by.
  const childJoins = [joins, node['Join Filter'], node['Hash Cond'], node['Merge Cond']].filter(Boolean).join(' ');
  for (const child of node.Plans ?? []) wholeScans(child, indexes, into, childJoins);
  return into;
}

/** The tables Postgres would read whole for `sql` with sequential scans off, planned without its values. */
export async function planWholeScans(prisma: PrismaClient, sql: string, indexes: Map<string, IndexLead>): Promise<WholeScan[]> {
  const parameters = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
  const values = parameters === 0 ? '' : `(${Array.from({ length: parameters }, () => 'NULL').join(', ')})`;
  // A prepared statement outlives its transaction, so each gets a name of its own.
  const name = `index_check_${randomUUID().replace(/-/g, '')}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_generic_plan');
    await tx.$executeRawUnsafe(`PREPARE ${name} AS ${sql}`);
    const [row] = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>>(`EXPLAIN (FORMAT JSON) EXECUTE ${name}${values}`);
    await tx.$executeRawUnsafe(`DEALLOCATE ${name}`);
    return wholeScans(row['QUERY PLAN'][0].Plan, indexes, []);
  });
}

/** The whole-table reads of growing tables, among `sent`, that no allowance covers. */
export async function findUnindexedScans(
  prisma: PrismaClient,
  sent: Iterable<Statement>,
  allowances: readonly TableScanAllowance[] = TABLE_SCAN_ALLOWANCES,
): Promise<ScanFinding[]> {
  const indexes = await readIndexLeads(prisma);
  const findings: ScanFinding[] = [];
  for (const statement of sent) {
    for (const scan of await planWholeScans(prisma, statement.sql, indexes)) {
      if (!GROWING_TABLES.has(scan.table)) continue;
      const shape = statementShape(statement.sql);
      if (allowances.some((allowance) => allowance.table === scan.table && shape.includes(allowance.sqlIncludes))) continue;
      findings.push({ ...scan, sql: statement.sql, test: statement.test });
    }
  }
  return findings;
}

/**
 * Plans the app's statements of this test file and forgets them for the next. The failure to
 * report, or null when every query on a growing table can use an index.
 */
export async function describeUnindexedScans(prisma: PrismaClient): Promise<string | null> {
  const findings = await findUnindexedScans(prisma, statements.values());
  statements.clear();
  if (findings.length === 0) return null;
  return [
    `${String(findings.length)} queries read a growing table whole, with no index for their filter (rules/model-change-rules.md *Indexes Follow The Reads And The Foreign Keys*):`,
    ...findings.map((finding) => `- ${finding.table}, read by ${finding.how}, sent in "${finding.test}":\n    ${finding.sql}`),
    'Add the index its filter needs, or list a deliberate whole read in tests/integration/table-scan-allowances.ts with its reason.',
  ].join('\n');
}

/**
 * #1243 — an app query that no index can serve fails the integration run, on any table but
 * reference data.
 *
 * With test data a table scan is as fast as an index lookup, so a missing index never shows in a
 * timing. Postgres's plan does: with `enable_seqscan = off` the planner still reads a table whole
 * when no index can serve the filter, by a sequential scan or by walking a whole index.
 * `database-indexes.integration.ts` covers foreign keys; this covers every other `where`,
 * `orderBy` and join the app sends.
 *
 * How it works. The integration app runs on a Prisma client of its own, and every statement it
 * sends reaches `indexCheck.receive`; the tests' seeds, reads and cleanup use another client, so
 * they are never planned. When a test file ends, `describeUnindexedScans` plans each distinct
 * statement generically (`plan_cache_mode = force_generic_plan`, so no bound value shapes the
 * plan) and reports a whole read of a table outside `REFERENCE_TABLES` that `TABLE_SCAN_ALLOWANCES`
 * does not list.
 *
 * Raw SQL lives here only, to ask Postgres for plans (Derek 2026-10-29: none in application code).
 */
import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { statementShape } from './statement-log';
import { TABLE_SCAN_ALLOWANCES, type TableScanAllowance } from './table-scan-allowances';

/**
 * Reference data: tables a migration or a root admin writes a handful of rows into, which stay
 * small however many leagues sign up. Every other table grows with customer data or with each
 * season's sport data, so a new table is checked unless it is listed here.
 */
export const REFERENCE_TABLES = new Set([
  '_prisma_migrations', 'sports', 'sport_leagues', 'event_series', 'contest_config_templates',
  'event_pages', 'event_page_offers', 'platform_runtime_configs', 'platform_runtime_config_history',
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

/** One node of a Postgres `EXPLAIN (FORMAT JSON)` plan, with the fields the check reads. */
export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Alias?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Recheck Cond'?: string;
  Filter?: string;
  'Join Filter'?: string;
  'Hash Cond'?: string;
  'Merge Cond'?: string;
  Plans?: PlanNode[];
}

/**
 * An index's table, the column it leads on (null when it leads on an expression) and that
 * column's operator class, which says which comparisons the index can serve.
 */
export interface IndexLead {
  table: string;
  column: string | null;
  operatorClass: string;
}

/** A read of a whole table in one plan: the table and how the plan reads it. */
export interface WholeScan {
  table: string;
  how: string;
}

const INDEX_NODES = new Set(['Index Scan', 'Index Only Scan', 'Bitmap Index Scan']);

/** Every index in the schema, by name. */
export async function readIndexLeads(prisma: PrismaClient): Promise<Map<string, IndexLead>> {
  const rows = await prisma.$queryRaw<Array<{ index_name: string; table_name: string; column_name: string | null; operator_class: string }>>`
    SELECT index_class.relname AS index_name, table_class.relname AS table_name, lead_column.attname AS column_name,
      pg_opclass.opcname AS operator_class
    FROM pg_index
    JOIN pg_class index_class ON index_class.oid = pg_index.indexrelid
    JOIN pg_class table_class ON table_class.oid = pg_index.indrelid
    JOIN pg_namespace ON pg_namespace.oid = table_class.relnamespace AND pg_namespace.nspname = 'public'
    JOIN pg_opclass ON pg_opclass.oid = pg_index.indclass[0]
    LEFT JOIN pg_attribute lead_column ON lead_column.attrelid = pg_index.indrelid AND lead_column.attnum = pg_index.indkey[0]`;
  return new Map(rows.map((row) => [row.index_name, { table: row.table_name, column: row.column_name, operatorClass: row.operator_class }]));
}

/** The comparisons a btree index serves on its first column, as Postgres prints them. */
const BTREE_COMPARISON = String.raw`(?:<=|>=|=|<(?![>=])|>|IS NULL\b)`;
/** `LIKE` and `ILIKE`, which only a trigram index serves. */
const PATTERN_MATCH = String.raw`~~\*?`;
/** A bound value on the right of a comparison: `$1`, `ANY ($1)`, `($1)::"SomeEnum"`. */
const BOUND_VALUE = String.raw`\s*(?:ANY\s*)?\(*\$\d+`;

/**
 * Whether `text`, a condition or filter, compares `column` in a way an index leading on it with
 * `operatorClass` can serve: the column itself (optionally cast) on the left of the operator, not
 * inside a function such as `lower(...)`. The column may be qualified by `alias`; `bound` also
 * requires a bound value on the right.
 */
function comparesColumn(text: string, column: string, operatorClass: string, alias: string | undefined, bound: boolean): boolean {
  const name = alias === undefined ? `"?${column}"?` : `(?:${alias}\\.)?"?${column}"?`;
  const operator = operatorClass === 'gin_trgm_ops' ? PATTERN_MATCH : BTREE_COMPARISON;
  return new RegExp(`(?<!\\w)\\(\\s*${name}\\)?(?:::[\\w"]+)?\\s*${operator}${bound ? BOUND_VALUE : ''}`).test(text);
}

/** Whether a join condition anywhere in `conditions` matches `column` of the node's table, after its alias. */
function joinsOn(conditions: string, column: string, alias: string): boolean {
  const qualified = `\\b${alias}\\."?${column}"?\\b`;
  return new RegExp(`(?:=\\s*\\(*${qualified}|${qualified}\\)?(?:::[\\w"]+)?\\s*=)`).test(conditions);
}

/**
 * Splits `text` at `separator` (` AND ` or ` OR `) where it is not inside parentheses, after
 * dropping parentheses that wrap all of it.
 */
function splitTopLevel(text: string, separator: string): string[] {
  let body = text.trim();
  while (body.startsWith('(') && closingParen(body, 0) === body.length - 1) body = body.slice(1, -1).trim();
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === '(') depth += 1;
    else if (body[at] === ')') depth -= 1;
    else if (depth === 0 && body.startsWith(separator, at)) {
      parts.push(body.slice(start, at));
      start = at + separator.length;
    }
  }
  return [...parts, body.slice(start)].map((part) => part.trim()).filter((part) => part !== '');
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '(') depth += 1;
    else if (text[at] === ')') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/**
 * Whether some index in `leads` could serve `condition`: a conjunction is served when one of its
 * terms is, a disjunction only when every branch is, and a single comparison when it compares a
 * column one of the indexes leads on by an operator that index serves.
 */
function servedBy(condition: string, leads: Array<IndexLead & { column: string }>, alias: string | undefined): boolean {
  const branches = splitTopLevel(condition, ' OR ');
  if (branches.length > 1) return branches.every((branch) => servedBy(branch, leads, alias));
  const terms = splitTopLevel(condition, ' AND ');
  if (terms.length > 1) return terms.some((term) => servedBy(term, leads, alias));
  const comparison = `(${terms[0] ?? ''})`;
  return leads.some((index) => comparesColumn(comparison, index.column, index.operatorClass, alias, false));
}

/** The aliases a condition names, among the plan's: qualified columns, and `own` when it names a bare one. */
function aliasesIn(text: string, aliases: Set<string>, own: string | undefined): Set<string> {
  const named = new Set([...text.matchAll(/\b(\w+)\./g)].map((match) => match[1]).filter((alias) => aliases.has(alias)));
  if (own !== undefined) named.add(own);
  return named;
}

/**
 * The aliases joined to `start` through the plan's conditions: a condition that names two aliases
 * joins them, whichever node carries it.
 */
function joinedAliases(start: string, nodes: PlanNode[], heapOf: Map<PlanNode, PlanNode>): Set<string> {
  const aliases = new Set(nodes.map((node) => node.Alias).filter((alias) => alias !== undefined));
  const groups = nodes.flatMap((node) => {
    const own = node.Alias ?? heapOf.get(node)?.Alias;
    return [
      ...[node['Index Cond'], node['Recheck Cond'], node.Filter].filter((text) => text !== undefined).map((text) => aliasesIn(text, aliases, own)),
      ...[node['Join Filter'], node['Hash Cond'], node['Merge Cond']].filter((text) => text !== undefined).map((text) => aliasesIn(text, aliases, undefined)),
    ];
  });
  const reached = new Set([start]);
  for (let grew = true; grew;) {
    grew = false;
    for (const group of groups) {
      if ([...group].some((alias) => reached.has(alias)) && [...group].some((alias) => !reached.has(alias))) {
        for (const alias of group) reached.add(alias);
        grew = true;
      }
    }
  }
  return reached;
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

function tableOf(node: PlanNode, indexes: Map<string, IndexLead>): string | undefined {
  return node['Relation Name'] ?? (node['Index Name'] === undefined ? undefined : indexes.get(node['Index Name'])?.table);
}

function ownConditions(node: PlanNode): string {
  return [node['Index Cond'], node['Recheck Cond'], node.Filter].filter((text) => text !== undefined).join(' ');
}

function indexesOn(table: string, indexes: Map<string, IndexLead>): Array<IndexLead & { column: string }> {
  return [...indexes.values()].filter((index): index is IndexLead & { column: string } => index.table === table && index.column !== null);
}

/**
 * Whether some node of the plan other than `walked`, on a table joined to it, filters its table by
 * a bound value an index on it could look up.
 */
function enteredByBoundValue(walked: PlanNode, walkedAlias: string, nodes: PlanNode[], indexes: Map<string, IndexLead>, heapOf: Map<PlanNode, PlanNode>): boolean {
  const joined = joinedAliases(walkedAlias, nodes, heapOf);
  return nodes.some((node) => {
    const alias = node.Alias ?? heapOf.get(node)?.Alias;
    const table = node === walked || alias === walkedAlias || alias === undefined || !joined.has(alias) ? undefined : tableOf(node, indexes);
    if (table === undefined) return false;
    const text = ownConditions(node);
    return indexesOn(table, indexes).some((index) => comparesColumn(text, index.column, index.operatorClass, alias, true));
  });
}

/**
 * Whether an index the table has could serve the read the planner served by walking another
 * index. On a table of a few test rows the planner may walk one index for its order and filter,
 * use a later column of another, or walk this side of a join and look the other side up, rather
 * than use the index that serves the read. That index exists, so nothing is missing, when:
 * - the node's own conditions are served by some index on the table (`servedBy`); or
 * - the plan joins the table by a column some index on it leads on, and a table joined to it is
 *   filtered by a bound value an index on that table could look up, so the read could start there.
 */
function anotherIndexServes(node: PlanNode, table: string, nodes: PlanNode[], indexes: Map<string, IndexLead>, heapOf: Map<PlanNode, PlanNode>): boolean {
  // A Bitmap Index Scan's rows are filtered by the Bitmap Heap Scan above it, which names the table.
  const heap = heapOf.get(node);
  const own = [node['Index Cond'], heap?.['Recheck Cond'], heap?.Filter, node.Filter].filter((text) => text !== undefined);
  const alias = node.Alias ?? heap?.Alias;
  const leads = indexesOn(table, indexes);
  if (own.length > 0 && servedBy(own.map((text) => `(${text})`).join(' AND '), leads, alias)) return true;
  if (alias === undefined) return false;
  const conditions = nodes.filter((other) => other !== node).map((other) => [ownConditions(other), other['Join Filter'], other['Hash Cond'], other['Merge Cond']].join(' ')).join(' ');
  return leads.some((index) => joinsOn(conditions, index.column, alias)) && enteredByBoundValue(node, alias, nodes, indexes, heapOf);
}

/**
 * The whole-table reads in a plan. With sequential scans off the planner still reads a table
 * whole when no index serves its filter, in one of four ways: a sequential scan; walking an index
 * by a condition on a column it does not lead on; walking an index for its order and filtering
 * every row; or walking an index with no condition at all, which reads every row unless a `Limit`
 * above it stops the walk early.
 */
export function findWholeScans(plan: PlanNode, indexes: Map<string, IndexLead>): WholeScan[] {
  const nodes = flatten(plan);
  const heapOf = new Map<PlanNode, PlanNode>();
  for (const heap of nodes.filter((node) => node['Node Type'] === 'Bitmap Heap Scan')) {
    for (const child of flatten(heap).slice(1)) heapOf.set(child, heap);
  }
  const underLimit = new Set(nodes.filter((node) => node['Node Type'] === 'Limit').flatMap((limit) => flatten(limit).slice(1)));
  const scans: WholeScan[] = [];
  for (const node of nodes) {
    const index = node['Index Name'] === undefined ? undefined : indexes.get(node['Index Name']);
    if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) {
      scans.push({ table: node['Relation Name'], how: 'a sequential scan' });
    } else if (INDEX_NODES.has(node['Node Type']) && index && !anotherIndexServes(node, index.table, nodes, indexes, heapOf)) {
      const condition = node['Index Cond'];
      if (condition === undefined && node.Filter !== undefined) {
        scans.push({ table: index.table, how: `walking every entry of ${String(node['Index Name'])} and filtering` });
      } else if (condition === undefined && !underLimit.has(node)) {
        scans.push({ table: index.table, how: `walking every entry of ${String(node['Index Name'])}, with no filter` });
      } else if (condition !== undefined && index.column !== null && !constrainsLead(condition, index.column)) {
        scans.push({ table: index.table, how: `walking all of ${String(node['Index Name'])}, which leads on ${index.column}` });
      }
    }
  }
  return scans;
}

/** Whether an index condition constrains the index's first column: Postgres prints it first in its clause. */
function constrainsLead(condition: string, column: string): boolean {
  return new RegExp(`\\(\\s*"?${column}"?\\b`).test(condition);
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
    return findWholeScans(row['QUERY PLAN'][0].Plan, indexes);
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
      if (REFERENCE_TABLES.has(scan.table)) continue;
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

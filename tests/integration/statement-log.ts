/**
 * #1242 — the SQL statements the integration Prisma clients send, as Prisma's query events
 * report them.
 *
 * `helpers.ts` builds its clients, the tests' and the app's, with query events on and has
 * `statementLog` watch both. A test reads what one call cost with `recordStatements`. The events
 * carry no async context, so the record is every statement the clients reported while the call
 * ran, which in this serial suite (`maxWorkers: 1`) is the call's own.
 *
 * Prisma reports a statement some time after the query that sent it has resolved, so a record
 * that simply stopped when the call resolved would miss its last statements, a different number
 * each run. Each edge of a record is a marker read instead: events arrive in order, so once the
 * marker's own event is in, every statement sent before it has been reported.
 */
import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/** One statement as the database saw it. */
export interface RecordedStatement {
  sql: string;
  params: string;
}

/**
 * The statement's shape: its SQL with every placeholder written `$?` and each `IN (...)` list as
 * one, so the same read of 2 ids and of 20 is one shape.
 */
export function statementShape(sql: string): string {
  return sql.replace(/\$\d+/g, '$?').replace(/IN \((?:\$\?,)*\$\?\)/g, 'IN ($?...)');
}

/** The pool's liveness check when it opens a connection: when it runs depends on the pool, not on the call. */
const CONNECTION_CHECK = 'SELECT 1';

type Recorder = (statement: RecordedStatement) => void;

const recorders = new Set<Recorder>();
const watched: PrismaClient[] = [];
/** Marker reads sent and not yet reported, by the id they look up. */
const pendingMarkers = new Map<string, () => void>();

export const statementLog = {
  /** Records `client`'s statements from now on; it must have been built with query events on. */
  watch(client: PrismaClient<Prisma.PrismaClientOptions, 'query'>): void {
    client.$on('query', (event) => statementLog.receive(event));
    watched.push(client);
  },

  /** Hands a reported statement to every open record. */
  receive(event: Prisma.QueryEvent): void {
    if (event.query === CONNECTION_CHECK) return;
    for (const [marker, reported] of pendingMarkers) {
      if (event.params.includes(marker)) {
        pendingMarkers.delete(marker);
        reported();
        return;
      }
    }
    const statement = { sql: event.query, params: event.params };
    for (const record of recorders) record(statement);
  },
};

/** Resolves once every statement the watched clients sent before it has been reported. */
async function reportedSoFar(): Promise<void> {
  await Promise.all(watched.map(async (client) => {
    const marker = randomUUID();
    const reported = new Promise<void>((resolve) => pendingMarkers.set(marker, resolve));
    await client.user.findUnique({ where: { id: marker }, select: { id: true } });
    await reported;
  }));
}

/** Runs `call` and returns what it resolved to with the statements the watched clients sent meanwhile, in order. */
export async function recordStatements<Result>(call: () => Promise<Result>): Promise<{ result: Result; statements: RecordedStatement[] }> {
  const statements: RecordedStatement[] = [];
  const record: Recorder = (statement) => statements.push(statement);
  await reportedSoFar();
  recorders.add(record);
  try {
    const result = await call();
    await reportedSoFar();
    return { result, statements };
  } finally {
    recorders.delete(record);
  }
}

/** What a statement does to its table. */
export enum StatementVerb {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/**
 * Each verb with how SQL names the table it acts on: Prisma's own statements qualify it with
 * `"public".`, a raw statement (a row lock) may not, and a count's subquery names its table first.
 */
const STATEMENT_TARGETS: ReadonlyArray<readonly [StatementVerb, RegExp]> = [
  [StatementVerb.SELECT, /^SELECT\b.*?\bFROM (?:"public"\.)?"(\w+)"/s],
  [StatementVerb.INSERT, /^INSERT INTO (?:"public"\.)?"(\w+)"/],
  [StatementVerb.UPDATE, /^UPDATE (?:"public"\.)?"(\w+)"/],
  [StatementVerb.DELETE, /^DELETE FROM (?:"public"\.)?"(\w+)"/],
];

/** A transaction's control statements, which act on no table. */
const TRANSACTION_CONTROL = /^(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/**
 * The verb and table of a statement, as `SELECT sport_events`, or null for transaction control.
 * Any other statement throws, so a statement no count can place never drops out of one unseen.
 */
export function statementTarget({ sql }: RecordedStatement): string | null {
  for (const [verb, pattern] of STATEMENT_TARGETS) {
    const table = pattern.exec(sql)?.[1];
    if (table !== undefined) return `${verb} ${table}`;
  }
  if (TRANSACTION_CONTROL.test(sql)) return null;
  throw new Error(`No table found in a recorded statement; teach statementTarget its form: ${sql.slice(0, 200)}`);
}

/** The statements that do `verb` to `table`. */
export function statementsOn(statements: readonly RecordedStatement[], verb: StatementVerb, table: string): RecordedStatement[] {
  return statements.filter((statement) => statementTarget(statement) === `${verb} ${table}`);
}

/** How many statements did each verb to each table, as `[target, count]` sorted by target; transaction control is left out. */
export function statementCounts(statements: readonly RecordedStatement[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const statement of statements) {
    const target = statementTarget(statement);
    if (target !== null) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right));
}

/** The values a statement was sent with, in placeholder order. */
export function statementParams({ params }: RecordedStatement): unknown[] {
  const parsed: unknown = JSON.parse(params);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * #1242 — the SQL statements the integration Prisma client sends, as Prisma's query events
 * report them.
 *
 * `helpers.ts` builds its client with query events on and hands each one to `statementLog`.
 * A test reads what one call cost with `recordStatements`. The events carry no async context,
 * so the record is every statement the client reported while the call ran, which in this serial
 * suite (`maxWorkers: 1`) is the call's own.
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
/** Marker reads sent and not yet reported, by the id they look up. */
const pendingMarkers = new Map<string, () => void>();

export const statementLog = {
  /** Wired once to the client's `$on('query')`: hands the statement to every open record. */
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

/** Resolves once every statement `prisma` sent before it has been reported. */
export async function reportedSoFar(prisma: PrismaClient): Promise<void> {
  const marker = randomUUID();
  const reported = new Promise<void>((resolve) => pendingMarkers.set(marker, resolve));
  await prisma.user.findUnique({ where: { id: marker }, select: { id: true } });
  await reported;
}

/** Runs `call` and returns what it resolved to with the statements `prisma` sent meanwhile, in order. */
export async function recordStatements<Result>(
  prisma: PrismaClient,
  call: () => Promise<Result>,
): Promise<{ result: Result; statements: RecordedStatement[] }> {
  const statements: RecordedStatement[] = [];
  const record: Recorder = (statement) => statements.push(statement);
  await reportedSoFar(prisma);
  recorders.add(record);
  try {
    const result = await call();
    await reportedSoFar(prisma);
    return { result, statements };
  } finally {
    recorders.delete(record);
  }
}

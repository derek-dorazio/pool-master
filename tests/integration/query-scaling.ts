/**
 * #1242 — a list route costs the same number of SQL statements for 2 rows as for 20.
 *
 * Every gate passed on the N+1 reads the 2026-10-28 audit found, because tests seed a handful of
 * rows and a handful of extra queries costs nothing measurable. Counting statements instead of
 * timing them catches the read that runs once per row at any data size.
 *
 * `rules/testing-rules.md` §9B *Query Scaling Tests* says when a test is required, and
 * `npm run rules:check:query-scaling` fails a list route that has none.
 */
import type { paths } from '@poolmaster/shared/generated/api-types';
import { deliverQueuedIntegrationEmail } from './helpers';
import { recordStatements, statementShape, type RecordedStatement } from './statement-log';

/** The API paths that answer a GET. */
type GetPath = { [Path in keyof paths]: paths[Path] extends { get: object } ? Path : never }[keyof paths];

/** A GET route as the OpenAPI spec names it, which is how the scanner matches a test to its route. */
export type ScalingRoute = `GET ${GetPath}`;

/** The row counts the two runs seed. */
export const SMALL_SEED = 2;
export const LARGE_SEED = 20;

export interface QueryScalingCase<Fixture, Result> {
  /** Seeds `rows` child rows (contests, teams, players...) under a fresh parent and returns what `call` needs. */
  seed: (rows: number) => Promise<Fixture>;
  /** The read being measured, against one seeded fixture. */
  call: (fixture: Fixture) => Promise<Result>;
  /** How many seeded rows the result shows; proves the larger seed reached the read, so the test is not vacuous. */
  rowsShown: (result: Result) => number;
}

export interface QueryScaling {
  small: RecordedStatement[];
  large: RecordedStatement[];
}

/** Seeds and reads a small fixture and then a large one, recording only each read. */
export async function measureQueryScaling<Fixture, Result>(scalingCase: QueryScalingCase<Fixture, Result>): Promise<QueryScaling> {
  const run = async (rows: number) => {
    const fixture = await scalingCase.seed(rows);
    // An email the seed queued is sent in the background, and its statements would land in one run's count.
    await deliverQueuedIntegrationEmail();
    const { result, statements } = await recordStatements(() => scalingCase.call(fixture));
    return { shown: scalingCase.rowsShown(result), statements };
  };
  const small = await run(SMALL_SEED);
  if (small.statements.length === 0) {
    throw new Error(
      'The read sent no statements the integration client reported, so its count proves nothing. '
        + 'Read through the app or getPrisma(), whose queries are recorded.',
    );
  }
  const large = await run(LARGE_SEED);
  if (large.shown <= small.shown) {
    throw new Error(
      `The read showed ${small.shown} rows for a seed of ${SMALL_SEED} and ${large.shown} for ${LARGE_SEED}: `
        + 'the larger seed never reached it, so its statement count proves nothing. Seed rows the read returns.',
    );
  }
  return { small: small.statements, large: large.statements };
}

/**
 * The statements whose count differs between the two runs, each with both counts, so a failure
 * names the repeated query instead of leaving a reader to diff two lists. Statements are compared
 * by shape, so a batched read of 2 ids and of 20 is one statement.
 */
export function describeScalingDifference({ small, large }: QueryScaling): string {
  const tally = (statements: RecordedStatement[]) => {
    const counts = new Map<string, number>();
    for (const { sql } of statements) {
      const shape = statementShape(sql);
      counts.set(shape, (counts.get(shape) ?? 0) + 1);
    }
    return counts;
  };
  const smallCounts = tally(small);
  const largeCounts = tally(large);
  const shapes = [...new Set([...smallCounts.keys(), ...largeCounts.keys()])];
  const changed = shapes
    .filter((sql) => smallCounts.get(sql) !== largeCounts.get(sql))
    .map((sql) => `  ${smallCounts.get(sql) ?? 0} -> ${largeCounts.get(sql) ?? 0}  ${sql}`);
  const list = (statements: RecordedStatement[]) => statements.map(({ sql }, index) => `  ${index + 1}. ${sql}`).join('\n');
  return [
    `${small.length} statements for ${SMALL_SEED} rows, ${large.length} for ${LARGE_SEED}.`,
    `Statements whose count changed (${SMALL_SEED} rows -> ${LARGE_SEED} rows):`,
    ...changed,
    `All statements for ${SMALL_SEED} rows:`,
    list(small),
    `All statements for ${LARGE_SEED} rows:`,
    list(large),
  ].join('\n');
}

/** Fails unless the read costs the same statements for a seed of 2 as for 20. */
export async function expectSameStatementCount<Fixture, Result>(scalingCase: QueryScalingCase<Fixture, Result>): Promise<void> {
  const scaling = await measureQueryScaling(scalingCase);
  if (scaling.small.length !== scaling.large.length) {
    throw new Error(`The statement count grows with the rows read.\n${describeScalingDifference(scaling)}`);
  }
}

/**
 * The scaling test for one list route: `route` names it for the `rules:check:query-scaling`
 * scanner and must be the route `call` requests.
 */
export async function expectConstantQueries<Fixture, Result>(
  scalingCase: QueryScalingCase<Fixture, Result> & { route: ScalingRoute },
): Promise<void> {
  await expectSameStatementCount(scalingCase);
}

/** A read of a list whose length code fixes, and the exact statements it sends. */
export interface FixedQueriesCase<Result> {
  route: ScalingRoute;
  /** What fixes the list's length, named in the failure. */
  fixedBy: string;
  call: () => Promise<Result>;
  /** How many of the items that could each cost a query the result shows; at least 2, or a per-item read sends no more. */
  rowsShown: (result: Result) => number;
  /** How many statements the read sends, whatever the fixed list holds. */
  statements: number;
}

/** The fewest items a fixed list must show for its pin to tell a per-item read from a batched one. */
export const FIXED_LIST_MIN_ROWS = 2;

/**
 * The test for a list route whose length code fixes (one row per plan, per email category, per
 * settings group), which no seed can grow from 2 to 20: it pins the exact statements the read
 * sends, so a per-row read added later fails it as a scaling case would. `route` names it for the
 * `rules:check:query-scaling` scanner and must be the route `call` requests.
 */
export async function expectFixedQueries<Result>(fixedCase: FixedQueriesCase<Result>): Promise<void> {
  await deliverQueuedIntegrationEmail();
  const { result, statements } = await recordStatements(() => fixedCase.call());
  const shown = fixedCase.rowsShown(result);
  if (shown < FIXED_LIST_MIN_ROWS) {
    throw new Error(
      `${fixedCase.route} showed ${shown} of ${fixedCase.fixedBy}: with fewer than ${FIXED_LIST_MIN_ROWS}, a read per item `
        + 'sends no more statements than one read for all of them, so the pin proves nothing. Show at least two.',
    );
  }
  if (statements.length !== fixedCase.statements) {
    throw new Error(
      `${fixedCase.route}, a list fixed by ${fixedCase.fixedBy}, sent ${statements.length} statements; `
        + `it is pinned at ${fixedCase.statements}.\n`
        + statements.map(({ sql }, index) => `  ${index + 1}. ${sql}`).join('\n'),
    );
  }
}

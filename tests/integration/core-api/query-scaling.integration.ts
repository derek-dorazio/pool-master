/**
 * #1242 — the query-scaling helper itself: it fails a read that queries once per row, passes one
 * that batches, and refuses a seed the read never shows.
 *
 * The rows are users, the plainest table to seed; what the helper measures does not depend on it.
 */
import { randomUUID } from 'crypto';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { expectSameStatementCount, LARGE_SEED, SMALL_SEED, type QueryScalingCase } from '../query-scaling';
import { recordStatements, statementShape } from '../statement-log';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** `rows` users, swept by `cleanupTestData` through their integration.test address. */
async function seedUsers(rows: number): Promise<string[]> {
  const ids = Array.from({ length: rows }, () => randomUUID());
  await getPrisma().user.createMany({
    data: ids.map((id) => ({
      id,
      email: `scaling-${id.slice(0, 8)}@integration.test`,
      username: `scaling-${id.slice(0, 8)}@integration.test`,
      firstName: 'Scaling',
      lastName: 'Row',
      passwordHash: 'not-a-login',
    })),
  });
  return ids;
}

type UserRows = { id: string }[];

const oneQueryPerRow: QueryScalingCase<string[], UserRows> = {
  seed: seedUsers,
  call: async (ids) => {
    const users: UserRows = [];
    for (const id of ids) users.push(await getPrisma().user.findUniqueOrThrow({ where: { id }, select: { id: true } }));
    return users;
  },
  rowsShown: (users) => users.length,
};

const batched: QueryScalingCase<string[], UserRows> = {
  seed: seedUsers,
  call: (ids) => getPrisma().user.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  rowsShown: (users) => users.length,
};

describe('recordStatements', () => {
  it('records the statements the call sends and none sent before it starts', async () => {
    await getPrisma().user.count();

    const { result, statements } = await recordStatements(getPrisma(), () => getPrisma().user.findMany({ where: { id: randomUUID() } }));

    expect(result).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/^SELECT .* FROM "public"\."users"/);
  });
});

describe('statementShape', () => {
  it('writes the same read of 2 ids and of 20 as one shape, and keeps a different filter apart', () => {
    const two = 'SELECT "id" FROM "users" WHERE ("id" IN ($1,$2) AND "status" = $3) OFFSET $4';
    const twenty = `SELECT "id" FROM "users" WHERE ("id" IN (${Array.from({ length: 20 }, (_, index) => `$${String(index + 1)}`).join(',')}) AND "status" = $21) OFFSET $22`;

    expect(statementShape(two)).toBe('SELECT "id" FROM "users" WHERE ("id" IN ($?...) AND "status" = $?) OFFSET $?');
    expect(statementShape(twenty)).toBe(statementShape(two));
    expect(statementShape('SELECT "id" FROM "users" WHERE "email" = $1')).not.toBe(statementShape(two));
  });
});

describe('expectSameStatementCount', () => {
  it('fails a read that queries once per row, naming the repeated statement with both counts', async () => {
    const failure = expectSameStatementCount(oneQueryPerRow);

    await expect(failure).rejects.toThrow(`${String(SMALL_SEED)} statements for ${String(SMALL_SEED)} rows, ${String(LARGE_SEED)} for ${String(LARGE_SEED)}.`);
    await expect(failure).rejects.toThrow(new RegExp(`  ${String(SMALL_SEED)} -> ${String(LARGE_SEED)}  SELECT .* FROM "public"\\."users"`));
  });

  it('passes a read that fetches every row in one statement', async () => {
    await expect(expectSameStatementCount(batched)).resolves.toBeUndefined();
  });

  it('refuses a case whose read sends no recorded statement, since a client nobody records would always look constant', async () => {
    const unrecorded: QueryScalingCase<string[], UserRows> = { ...batched, call: (ids) => Promise.resolve(ids.map((id) => ({ id }))) };

    await expect(expectSameStatementCount(unrecorded)).rejects.toThrow(/sent no statements the integration client reported/);
  });

  it('refuses a case whose read shows no more rows for the larger seed, since its count would prove nothing', async () => {
    const vacuous: QueryScalingCase<string[], UserRows> = { ...batched, call: (ids) => batched.call(ids.slice(0, 1)) };

    await expect(expectSameStatementCount(vacuous)).rejects.toThrow(/the larger seed never reached it/);
  });
});

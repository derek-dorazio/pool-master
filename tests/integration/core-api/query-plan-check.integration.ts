/**
 * #1243 — the missing-index check every integration suite runs at teardown, run against reads
 * chosen to need, or not need, a table scan.
 */
import { getPrisma, outsideQueryPlanCheck, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { reportedSoFar } from '../statement-log';
import { allowanceFor, expectEveryQueryIndexed, findUnindexedScans, queryPlanLog, type LoggedQuery } from '../query-plans';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

/** No index leads on an entry's name, so a read by it has to scan contest_entries. */
const UNINDEXED_NAME = 'no index serves this name';

/** The statements `read` sends, as the check logs them, leaving the log as it found it empty. */
async function loggedBy(read: () => Promise<unknown>): Promise<LoggedQuery[]> {
  const prisma = getPrisma();
  await reportedSoFar(prisma);
  queryPlanLog.take();
  await read();
  await reportedSoFar(prisma);
  return queryPlanLog.take().filter((query) => query.sql.includes('"public"."contest_entries"'));
}

describe('missing-index check', () => {
  it('finds the scan a read by a column no index leads on needs, and none once an index on it exists', async () => {
    const prisma = getPrisma();
    const queries = await loggedBy(() => prisma.contestEntry.findMany({ where: { name: UNINDEXED_NAME } }));
    expect(queries).toHaveLength(1);

    const scans = await findUnindexedScans(prisma, queries);
    expect(scans.map(({ table, filter }) => ({ table, filter }))).toEqual([
      { table: 'contest_entries', filter: '(name = $?)' },
    ]);
    expect(scans[0]?.query.test).toBe(expect.getState().currentTestName);

    await prisma.$executeRawUnsafe('CREATE INDEX contest_entries_plan_check_name_idx ON contest_entries (name)');
    try {
      await expect(findUnindexedScans(prisma, queries)).resolves.toEqual([]);
    } finally {
      await prisma.$executeRawUnsafe('DROP INDEX contest_entries_plan_check_name_idx');
    }
  });

  it('finds no scan for a read by the columns an index leads on', async () => {
    const prisma = getPrisma();
    const queries = await loggedBy(() =>
      prisma.contestEntry.findMany({ where: { squadId: '00000000-0000-0000-0000-000000000000' } }));

    await expect(findUnindexedScans(prisma, queries)).resolves.toEqual([]);
  });

  it('logs nothing test code runs outside the check, and the app statements on either side as usual', async () => {
    const prisma = getPrisma();
    const queries = await loggedBy(async () => {
      await prisma.contestEntry.findMany({ where: { squadId: '00000000-0000-0000-0000-000000000000' } });
      await outsideQueryPlanCheck(() => prisma.contestEntry.findMany({ where: { name: UNINDEXED_NAME } }));
      await prisma.contestEntry.count({ where: { squadId: '00000000-0000-0000-0000-000000000000' } });
    });

    expect(queries.map((query) => query.sql)).toEqual([
      expect.stringContaining('"squad_id" = $1'),
      expect.stringContaining('COUNT'),
    ]);
  });

  it('fails teardown on a scan the allow-list does not name, with its table, filter, SQL and test', async () => {
    const prisma = getPrisma();
    await reportedSoFar(prisma);
    queryPlanLog.take();
    await prisma.contestEntry.findMany({ where: { name: UNINDEXED_NAME } });
    await reportedSoFar(prisma);

    const failure = expectEveryQueryIndexed(prisma);

    await expect(failure).rejects.toThrow('contest_entries filtered by (name = $?)');
    await expect(failure).rejects.toThrow('WHERE "public"."contest_entries"."name" = $1');
    await expect(failure).rejects.toThrow(`test: ${expect.getState().currentTestName}`);
  });

  it('lets a scan through only when an allowance names its table and its exact filter', () => {
    const allowList = [{ table: 'contest_entries' as const, filter: '(name = $?)', reason: 'a test allowance' }];

    expect(allowanceFor({ table: 'contest_entries', filter: '(name = $?)' }, allowList)).toBe(allowList[0]);
    expect(allowanceFor({ table: 'contest_entries', filter: '(name <> $?)' }, allowList)).toBeUndefined();
    expect(allowanceFor({ table: 'squads', filter: '(name = $?)' }, allowList)).toBeUndefined();
    expect(allowanceFor({ table: 'contest_entries', filter: null }, allowList)).toBeUndefined();
  });
});

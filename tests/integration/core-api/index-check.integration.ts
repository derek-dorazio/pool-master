/**
 * #1243 — the missing-index check itself: it reports an app query that reads a growing table whole
 * because no index serves its filter, passes it once an index does, and plans only what the app's
 * client sends.
 *
 * The probes filter `users.timezone`, which no index has, and `league_memberships.joined_at`,
 * which only an index leading on `status` holds. The probe index is dropped after.
 */
import type { Prisma } from '@prisma/client';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { describeUnindexedScans, findUnindexedScans, indexCheck, planWholeScans, readIndexLeads, type Statement } from '../index-check';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const BY_TIMEZONE = 'SELECT "public"."users"."id" FROM "public"."users" WHERE "public"."users"."timezone" = $1';
const BY_TIMEZONE_IN_ID_ORDER = `${BY_TIMEZONE} ORDER BY "public"."users"."id"`;
const BY_EMAIL = 'SELECT "public"."users"."id" FROM "public"."users" WHERE "public"."users"."email" = $1';
const MEMBERSHIPS_BY_JOINED_AT = 'SELECT "public"."league_memberships"."id" FROM "public"."league_memberships" WHERE "public"."league_memberships"."joined_at" = $1';
const MEMBERSHIPS_BY_LEAGUE = 'SELECT "public"."league_memberships"."id" FROM "public"."league_memberships" WHERE "public"."league_memberships"."league_id" = $1';
const ENTRIES_BY_CONTEST_IN_ORDER = 'SELECT "public"."contest_entries"."id" FROM "public"."contest_entries" WHERE "public"."contest_entries"."contest_id" = $1 ORDER BY "public"."contest_entries"."created_at" ASC, "public"."contest_entries"."id" ASC OFFSET $2';
const RESULTS_BY_EVENT = 'SELECT "r"."id" FROM "public"."sport_event_participant_race_results" AS "r" JOIN "public"."sport_event_participants" AS "p" ON "r"."sport_event_participant_id" = "p"."id" WHERE "p"."sport_event_id" = $1 AND "r"."is_official" = $2';
const MEMBERSHIPS_JOINED_WITH_USER = 'SELECT "m"."id" FROM "public"."users" AS "u" JOIN "public"."league_memberships" AS "m" ON "m"."joined_at" = "u"."created_at" WHERE "u"."id" = $1';
const SPORTS_BY_TYPE = 'SELECT "public"."sports"."id" FROM "public"."sports" WHERE "public"."sports"."participant_type" = $1';

function sent(sql: string): Statement {
  return { sql, test: 'a probe' };
}

function queryEvent(query: string): Prisma.QueryEvent {
  return { timestamp: new Date(), query, params: '[]', duration: 0, target: 'quaint::connector::metrics' };
}

describe('missing-index check', () => {
  it('reports a read of a growing table filtered by a column no index has, as a sequential scan naming the table and the test', async () => {
    const findings = await findUnindexedScans(getPrisma(), [sent(BY_TIMEZONE)]);
    expect(findings).toEqual([{ table: 'users', how: 'a sequential scan', sql: BY_TIMEZONE, test: 'a probe' }]);
  });

  it('reports a filter on a column an index holds but does not lead on, which walks the whole index', async () => {
    const findings = await findUnindexedScans(getPrisma(), [sent(MEMBERSHIPS_BY_JOINED_AT)]);
    expect(findings).toEqual([{
      table: 'league_memberships',
      how: 'walking all of league_memberships_status_joined_at_idx, which leads on status',
      sql: MEMBERSHIPS_BY_JOINED_AT,
      test: 'a probe',
    }]);
  });

  it('reports an unindexed filter in the order of another index, which walks that index and filters every row', async () => {
    const findings = await findUnindexedScans(getPrisma(), [sent(BY_TIMEZONE_IN_ID_ORDER)]);
    expect(findings.map((finding) => finding.how)).toEqual(['walking every entry of users_pkey and filtering']);
  });

  it('passes the unindexed reads once an index leads on their filter, and reads by an indexed column', async () => {
    await getPrisma().$executeRawUnsafe('CREATE INDEX index_check_probe ON users (timezone)');
    try {
      expect(await findUnindexedScans(getPrisma(), [sent(BY_TIMEZONE), sent(BY_TIMEZONE_IN_ID_ORDER), sent(BY_EMAIL), sent(MEMBERSHIPS_BY_LEAGUE)])).toEqual([]);
    } finally {
      await getPrisma().$executeRawUnsafe('DROP INDEX index_check_probe');
    }
  });

  it('passes a read whose filter an index leads on, though on test-sized tables the planner walks another index for its order', async () => {
    const indexes = await readIndexLeads(getPrisma());
    const scans = await planWholeScans(getPrisma(), ENTRIES_BY_CONTEST_IN_ORDER, indexes);
    expect(scans).toEqual([]);
  });

  it('passes a join whose inner table an index leads on the join column of, and reports one joined by a column no index leads on', async () => {
    const indexes = await readIndexLeads(getPrisma());
    expect(await planWholeScans(getPrisma(), RESULTS_BY_EVENT, indexes)).toEqual([]);
    const scans = await planWholeScans(getPrisma(), MEMBERSHIPS_JOINED_WITH_USER, indexes);
    expect(scans.map((scan) => scan.table)).toEqual(['league_memberships']);
  });

  it('does not report a whole read of a reference table, which stays a handful of rows', async () => {
    const indexes = await readIndexLeads(getPrisma());
    expect(await planWholeScans(getPrisma(), SPORTS_BY_TYPE, indexes)).toEqual([{ table: 'sports', how: 'a sequential scan' }]);
    expect(await findUnindexedScans(getPrisma(), [sent(SPORTS_BY_TYPE)])).toEqual([]);
  });

  it('does not report a read an allowance covers by its table and a fragment of its SQL', async () => {
    const allowance = { table: 'users', sqlIncludes: '"timezone" = $?', reason: 'a probe' };
    expect(await findUnindexedScans(getPrisma(), [sent(BY_TIMEZONE)], [allowance])).toEqual([]);
    expect(await findUnindexedScans(getPrisma(), [sent(BY_TIMEZONE)], [{ ...allowance, table: 'leagues' }])).toHaveLength(1);
  });

  it("plans the reads the app's client reports and not the tests' own reads or any insert", async () => {
    // This file's earlier app statements are planned here rather than at teardown.
    expect(await describeUnindexedScans(getPrisma())).toBeNull();
    await getPrisma().user.findFirst({ where: { timezone: 'Etc/UTC' }, select: { id: true } });
    expect(await describeUnindexedScans(getPrisma())).toBeNull();

    indexCheck.receive(queryEvent('INSERT INTO "public"."users" ("timezone") VALUES ($1)'));
    indexCheck.receive(queryEvent(BY_TIMEZONE));
    const failure = await describeUnindexedScans(getPrisma());
    expect(failure).toContain('1 queries read a growing table whole, with no index for their filter');
    expect(failure).toContain(`- users, read by a sequential scan, sent in "missing-index check plans the reads the app's client reports`);
    expect(await describeUnindexedScans(getPrisma())).toBeNull();
  });
});

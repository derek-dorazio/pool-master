/**
 * #1243 — the missing-index check itself: it reports an app query that reads a growing table whole
 * because no index serves its filter, passes it once an index does, and plans only what the app's
 * client sends.
 *
 * The live probes filter `users.timezone`, which no index has, and `league_memberships.joined_at`,
 * which only an index leading on `status` holds; the probe index is dropped after. Whether another
 * index could serve a read the planner walked is tested on fixed plans, since on test-sized tables
 * which plan Postgres picks depends on the statistics other files leave.
 */
import type { Prisma } from '@prisma/client';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import {
  describeUnindexedScans,
  findUnindexedScans,
  findWholeScans,
  indexCheck,
  planWholeScans,
  readIndexLeads,
  REFERENCE_TABLES,
  type IndexLead,
  type PlanNode,
  type Statement,
} from '../index-check';

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
const LEAGUES_BY_CODE_PATTERN_IN_ORDER = 'SELECT "public"."leagues"."id" FROM "public"."leagues" WHERE "public"."leagues"."league_code"::text ILIKE $1 ORDER BY "public"."leagues"."id"';
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

  it('reports an ILIKE filter read in key order, which a plain index on the column cannot serve', async () => {
    const findings = await findUnindexedScans(getPrisma(), [sent(LEAGUES_BY_CODE_PATTERN_IN_ORDER)]);
    expect(findings.map((finding) => [finding.table, finding.how])).toEqual([['leagues', 'walking every entry of leagues_pkey and filtering']]);
  });

  it('reports a join on a column no index of the joined table leads on', async () => {
    const indexes = await readIndexLeads(getPrisma());
    const scans = await planWholeScans(getPrisma(), MEMBERSHIPS_JOINED_WITH_USER, indexes);
    expect(scans.map((scan) => scan.table)).toEqual(['league_memberships']);
  });

  it('does not report a whole read of a reference table, which stays a handful of rows', async () => {
    const indexes = await readIndexLeads(getPrisma());
    expect(await planWholeScans(getPrisma(), SPORTS_BY_TYPE, indexes)).toEqual([{ table: 'sports', how: 'a sequential scan' }]);
    expect(await findUnindexedScans(getPrisma(), [sent(SPORTS_BY_TYPE)])).toEqual([]);
  });

  it('lists only reference tables the schema has, so a renamed one cannot linger', async () => {
    const tables = await getPrisma().$queryRaw<Array<{ relname: string }>>`
      SELECT pg_class.relname FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public' AND pg_class.relkind = 'r'`;
    const names = new Set(tables.map((table) => table.relname));
    expect([...REFERENCE_TABLES].filter((table) => !names.has(table))).toEqual([]);
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

/** The indexes the fixed plans below use, as `readIndexLeads` returns them. */
const INDEXES = new Map<string, IndexLead>([
  ['leagues_pkey', { table: 'leagues', column: 'id', operatorClass: 'uuid_ops' }],
  ['leagues_league_code_key', { table: 'leagues', column: 'league_code', operatorClass: 'text_ops' }],
  ['users_pkey', { table: 'users', column: 'id', operatorClass: 'uuid_ops' }],
  ['users_email_key', { table: 'users', column: 'email', operatorClass: 'text_ops' }],
  ['users_email_trgm_idx', { table: 'users', column: 'email', operatorClass: 'gin_trgm_ops' }],
  ['contest_entries_id_contest_id_key', { table: 'contest_entries', column: 'id', operatorClass: 'uuid_ops' }],
  ['contest_entries_contest_id_squad_id_entry_number_key', { table: 'contest_entries', column: 'contest_id', operatorClass: 'uuid_ops' }],
  ['league_memberships_user_id_status_idx', { table: 'league_memberships', column: 'user_id', operatorClass: 'uuid_ops' }],
  ['race_results_participant_key', { table: 'sport_event_participant_race_results', column: 'sport_event_participant_id', operatorClass: 'uuid_ops' }],
  ['sport_event_participants_pkey', { table: 'sport_event_participants', column: 'id', operatorClass: 'uuid_ops' }],
  ['sport_event_participants_sport_event_id_participant_id_key', { table: 'sport_event_participants', column: 'sport_event_id', operatorClass: 'uuid_ops' }],
]);

function indexScan(index: string, alias: string, conditions: Pick<PlanNode, 'Index Cond' | 'Filter'>): PlanNode {
  return { 'Node Type': 'Index Scan', 'Index Name': index, 'Relation Name': INDEXES.get(index)?.table, Alias: alias, ...conditions };
}

function nestedLoop(outer: PlanNode, inner: PlanNode, joinFilter?: string): PlanNode {
  return { 'Node Type': 'Nested Loop', ...(joinFilter === undefined ? {} : { 'Join Filter': joinFilter }), Plans: [outer, inner] };
}

describe('missing-index check on fixed plans: whether another index could serve a walked read', () => {
  it('passes a walk in key order filtered by a column another index leads on, and a walk by that column held second', () => {
    expect(findWholeScans(indexScan('contest_entries_id_contest_id_key', 'contest_entries', { Filter: '(contest_id = $1)' }), INDEXES)).toEqual([]);
    expect(findWholeScans(indexScan('contest_entries_id_contest_id_key', 'contest_entries', { 'Index Cond': '(contest_id = ANY ($1))' }), INDEXES)).toEqual([]);
  });

  it('reports the same walk when the filter is an ILIKE or a function of the column, which a plain index cannot serve', () => {
    expect(findWholeScans(indexScan('leagues_pkey', 'leagues', { Filter: '((league_code)::text ~~* $1)' }), INDEXES))
      .toEqual([{ table: 'leagues', how: 'walking every entry of leagues_pkey and filtering' }]);
    expect(findWholeScans(indexScan('users_pkey', 'users', { Filter: '(lower(email) = $1)' }), INDEXES))
      .toEqual([{ table: 'users', how: 'walking every entry of users_pkey and filtering' }]);
  });

  it('passes an ILIKE filter on a column a trigram index leads on', () => {
    expect(findWholeScans(indexScan('users_pkey', 'users', { Filter: '((email)::text ~~* $1)' }), INDEXES)).toEqual([]);
  });

  it('passes a walked side of a join looked up by its indexed join key from a side a bound value could enter by index', () => {
    const lookedUp = nestedLoop(
      indexScan('race_results_participant_key', 'r', { Filter: '(is_official = $2)' }),
      indexScan('sport_event_participants_pkey', 'p', { 'Index Cond': '(id = r.sport_event_participant_id)', Filter: '(sport_event_id = $1)' }),
    );
    const joinFiltered = nestedLoop(
      indexScan('race_results_participant_key', 'r', { Filter: '(is_official = $2)' }),
      indexScan('sport_event_participants_pkey', 'p', { Filter: '(sport_event_id = $1)' }),
      '(r.sport_event_participant_id = p.id)',
    );
    expect(findWholeScans(lookedUp, INDEXES)).toEqual([]);
    expect(findWholeScans(joinFiltered, INDEXES)).toEqual([]);
  });

  it('reports the walked side of a join when no side is filtered by a bound value an index could look up', () => {
    const plan = nestedLoop(
      indexScan('users_pkey', 'u', { Filter: '((timezone)::text = $1)' }),
      indexScan('league_memberships_user_id_status_idx', 'm', { 'Index Cond': '(user_id = u.id)' }),
    );
    expect(findWholeScans(plan, INDEXES)).toEqual([{ table: 'users', how: 'walking every entry of users_pkey and filtering' }]);
  });
});

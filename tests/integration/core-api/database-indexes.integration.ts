/**
 * #1167, #1168, #1177, #1178 — the indexes the migrated database carries, checked against the
 * catalog rather than taken on trust.
 *
 * Postgres indexes neither side of a foreign key's referencing column on its own, so a delete of
 * the referenced row, and every read by that column, scans the referencing table. Every foreign
 * key here has an index leading on its first column. An index another one already leads with is
 * the opposite cost: every write maintains it and no read needs it.
 *
 * The hot reads each name the columns they filter by, so dropping or reshaping the index one leans
 * on fails here rather than showing as a slow page months later. Schema and migration agreeing is
 * `npm run db:drift:check`; this suite covers what that gate cannot see.
 */
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());

/** Each index on `table`, as its key columns in order. */
async function indexColumns(table: string): Promise<string[][]> {
  const rows = await getPrisma().$queryRaw<Array<{ columns: string[] }>>`
    SELECT array_agg(a.attname ORDER BY k.position) AS columns
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, position)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indrelid = ${table}::regclass AND i.indpred IS NULL
    GROUP BY i.indexrelid`;
  return rows.map((row) => row.columns);
}

describe('database indexes', () => {
  it('gives every foreign key an index leading on its first column, so deleting the row it names never scans the referencing table', async () => {
    const unindexed = await getPrisma().$queryRaw<Array<{ foreign_key: string }>>`
      SELECT c.conrelid::regclass || '.' || c.conname AS foreign_key
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indpred IS NULL AND i.indkey[0] = c.conkey[1]
        )
      ORDER BY 1`;

    expect(unindexed.map((row) => row.foreign_key)).toEqual([]);
  });

  it('keeps no plain index whose columns another index on the table already starts with, since every write would maintain it for nothing', async () => {
    const redundant = await getPrisma().$queryRaw<Array<{ redundant: string; covered_by: string }>>`
      SELECT a.indexrelid::regclass::text AS redundant, b.indexrelid::regclass::text AS covered_by
      FROM pg_index a
      JOIN pg_index b ON b.indrelid = a.indrelid AND b.indexrelid <> a.indexrelid
      JOIN pg_class ac ON ac.oid = a.indexrelid
      JOIN pg_class bc ON bc.oid = b.indexrelid
      WHERE ac.relnamespace = 'public'::regnamespace
        AND ac.relam = bc.relam
        AND NOT a.indisunique
        AND a.indpred IS NULL AND b.indpred IS NULL
        AND a.indexprs IS NULL AND b.indexprs IS NULL
        AND a.indnatts <= b.indnatts
        AND (b.indkey::int2[])[0:a.indnatts - 1] = (a.indkey::int2[])[0:a.indnatts - 1]
      ORDER BY 1, 2`;

    expect(redundant).toEqual([]);
  });

  it('keeps no index on the live-score standings status or position, which no read filters on and every rank update would maintain', async () => {
    const indexes = await getPrisma().$queryRaw<Array<{ column: string }>>`
      SELECT a.attname AS column
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = 'sport_event_participant_standings'::regclass
      ORDER BY 1`;

    expect(indexes.map((row) => row.column)).toEqual(['id', 'sport_event_participant_id']);
  });

  it.each([
    ["a squad's entries in one contest, read on every entry create, update and delete", 'contest_entries', ['contest_id', 'squad_id']],
    ["a squad's entries in every contest, read when the squad is deleted", 'contest_entries', ['squad_id']],
    ["a user's league memberships in one status, read on every My leagues load", 'league_memberships', ['user_id', 'status']],
    ["a user's squad memberships, read when the user is deleted", 'squad_memberships', ['user_id']],
    ['the squads a user created, read when the user is deleted', 'squads', ['created_by']],
    ['active members who joined since the last member-joined sweep, in joining order', 'league_memberships', ['status', 'joined_at']],
    ['leagues whose plan ends by a time, locked by the plan sweep every five minutes', 'leagues', ['plan_renews_at']],
    ['the active root admins the draft-event notice is sent to', 'users', ['is_root_admin', 'is_active']],
    ['the events in a status, which the lifecycle sweep moves on', 'sport_events', ['status']],
    ["a league's emails, oldest first", 'email_messages', ['league_id', 'created_at']],
    ["a person's emails, oldest first", 'email_messages', ['recipient_user_id', 'created_at']],
  ])('reads %s through an index leading on the columns it filters by', async (_read, table, columns) => {
    const leading = (await indexColumns(table)).map((index) => index.slice(0, columns.length));

    expect(leading).toContainEqual(columns);
  });
});

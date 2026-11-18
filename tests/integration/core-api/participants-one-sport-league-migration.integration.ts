/**
 * #1853 — the migration that puts each participant in one sport league applies to a database that
 * already holds participants, affiliations and provider mappings, as QA's does, against real
 * Postgres. A scratch database gets every migration before it, the rows the old model allowed,
 * then this migration; the rows it leaves are read back with the new client.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

const PRISMA_DIR = join(__dirname, '../../../packages/core-api/prisma');
const CORE_API_DIR = join(__dirname, '../../../packages/core-api');
const MIGRATION = '20271210000000_participants_belong_to_one_sport_league';
const SCRATCH_DATABASE = `poolmaster_migration_${randomUUID().slice(0, 8)}_test`;

const ids = {
  rankedTwice: randomUUID(),
  unaffiliated: randomUUID(),
  mappedTwice: randomUUID(),
};

let workDir = '';
let scratchUrl = '';

/** The test database's URL naming another database on the same server. */
function urlOf(database: string): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/poolmaster_test');
  url.pathname = `/${database}`;
  return url.toString();
}

function prismaCli(args: string[], input?: string): void {
  const run = spawnSync('npx', ['prisma', ...args], {
    cwd: CORE_API_DIR,
    env: { ...process.env, DATABASE_URL: scratchUrl },
    encoding: 'utf8',
    input,
  });
  if (run.status !== 0) throw new Error(`prisma ${args.join(' ')} failed:\n${run.stdout}\n${run.stderr}`);
}

/** Rows the old model allowed: a golfer on two tours, one on none, and one with two providers' ids. */
const OLD_MODEL_ROWS = `
INSERT INTO "participants" ("id", "sport_id", "name", "participant_type", "updated_at") VALUES
  ('${ids.rankedTwice}', (SELECT "id" FROM "sports" WHERE "sport" = 'GOLF'), 'Ranked Twice', 'INDIVIDUAL', now()),
  ('${ids.unaffiliated}', (SELECT "id" FROM "sports" WHERE "sport" = 'GOLF'), 'Unaffiliated', 'INDIVIDUAL', now()),
  ('${ids.mappedTwice}', (SELECT "id" FROM "sports" WHERE "sport" = 'TENNIS'), 'Mapped Twice', 'INDIVIDUAL', now());
INSERT INTO "participant_league_affiliations" ("participant_id", "sport_league_id", "ranking", "updated_at") VALUES
  ('${ids.rankedTwice}', (SELECT "id" FROM "sport_leagues" WHERE "name" = 'PGA TOUR'), 12, now()),
  ('${ids.rankedTwice}', (SELECT "id" FROM "sport_leagues" WHERE "name" = 'LPGA Tour'), 3, now()),
  ('${ids.mappedTwice}', (SELECT "id" FROM "sport_leagues" WHERE "name" = 'WTA'), NULL, now());
INSERT INTO "participant_provider_mappings" ("participant_id", "provider_id", "external_id", "updated_at") VALUES
  ('${ids.rankedTwice}', 'balldontlie', 'golfer-1', now()),
  ('${ids.mappedTwice}', 'balldontlie', 'tennis-1', now()),
  ('${ids.mappedTwice}', 'other-feed', 'tennis-1', now());
`;

beforeAll(async () => {
  await setupIntegrationTests();
  await getPrisma().$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DATABASE}"`);
  scratchUrl = urlOf(SCRATCH_DATABASE);
  // Every migration before this one, in a folder of their own.
  workDir = mkdtempSync(join(tmpdir(), 'migration-1853-'));
  cpSync(join(PRISMA_DIR, 'schema.prisma'), join(workDir, 'schema.prisma'));
  for (const entry of readdirSync(join(PRISMA_DIR, 'migrations'))) {
    if (entry >= MIGRATION && entry !== 'migration_lock.toml') continue;
    cpSync(join(PRISMA_DIR, 'migrations', entry), join(workDir, 'migrations', entry), { recursive: true });
  }
  prismaCli(['migrate', 'deploy', '--schema', join(workDir, 'schema.prisma')]);
  writeFileSync(join(workDir, 'old-model-rows.sql'), OLD_MODEL_ROWS);
  prismaCli(['db', 'execute', '--url', scratchUrl, '--file', join(workDir, 'old-model-rows.sql')]);
  prismaCli(['db', 'execute', '--url', scratchUrl, '--file', join(PRISMA_DIR, 'migrations', MIGRATION, 'migration.sql')]);
}, 180_000);

afterAll(async () => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  await getPrisma().$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DATABASE}" WITH (FORCE)`);
  await teardownIntegrationTests();
});

describe('the participants-in-one-sport-league migration on a database with rows (#1853)', () => {
  async function readBack() {
    const scratch = new PrismaClient({ datasourceUrl: scratchUrl });
    try {
      const participants = await scratch.participant.findMany({
        where: { id: { in: Object.values(ids) } },
        select: { id: true, ranking: true, sportLeague: { select: { name: true } } },
      });
      const mappings = await scratch.participantProviderMapping.findMany({
        where: { participantId: { in: Object.values(ids) } },
        select: { participantId: true, providerId: true, sportLeague: { select: { name: true } } },
        orderBy: [{ participantId: 'asc' }, { providerId: 'asc' }],
      });
      return { participants: new Map(participants.map((row) => [row.id, row])), mappings };
    } finally {
      await scratch.$disconnect();
    }
  }

  it('puts a participant on two tours in its best-ranked one, with that ranking', async () => {
    const { participants } = await readBack();

    expect(participants.get(ids.rankedTwice)).toMatchObject({ ranking: 3, sportLeague: { name: 'LPGA Tour' } });
  });

  it('puts a participant on no tour in its sport\'s first league by name, unranked', async () => {
    const { participants } = await readBack();

    expect(participants.get(ids.unaffiliated)).toMatchObject({ ranking: null, sportLeague: { name: 'LPGA Tour' } });
  });

  it('gives every provider mapping its participant\'s sport league', async () => {
    const { mappings } = await readBack();

    expect(mappings.filter((mapping) => mapping.participantId === ids.mappedTwice)).toEqual([
      { participantId: ids.mappedTwice, providerId: 'balldontlie', sportLeague: { name: 'WTA' } },
      { participantId: ids.mappedTwice, providerId: 'other-feed', sportLeague: { name: 'WTA' } },
    ]);
    expect(mappings.find((mapping) => mapping.participantId === ids.rankedTwice)).toMatchObject({ sportLeague: { name: 'LPGA Tour' } });
  });
});

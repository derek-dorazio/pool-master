/**
 * #450 — the settings registry against real Postgres: what a save stores and records, how a
 * save on one core-api task reaches another, that booting writes nothing, and the migration
 * that cleans the retired feed policies out of a stored ingestion schedule.
 *
 * Production runs two core-api tasks on one database. Each case that needs a second task builds
 * its own `AppSettingsService` on the shared Prisma client; the refresh that would run on its
 * 30-second timer is called directly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaPlatformRuntimeConfigRepository } from '../../../packages/core-api/src/adapters';
import {
  AppSettingsService,
  SettingsConflictError,
} from '../../../packages/core-api/src/modules/platform/app-settings-service';
import { POLL_INTERVAL_SETTINGS } from '../../../packages/core-api/src/modules/platform/poll-config-service';
import {
  INGESTION_SCHEDULE_SETTINGS,
  IngestionConfigService,
} from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { SETTINGS_GROUPS } from '../../../packages/core-api/src/modules/platform/settings-groups';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

function coreApiTask(): AppSettingsService {
  return new AppSettingsService({
    repository: new PrismaPlatformRuntimeConfigRepository(getPrisma()),
    groups: SETTINGS_GROUPS,
    env: process.env,
  });
}

beforeAll(() => setupIntegrationTests());
afterAll(() => teardownIntegrationTests());
beforeEach(() => cleanupTestData());

describe('settings registry on Postgres', () => {
  it('a task booting against an empty settings table serves the defaults and writes no row and no history', async () => {
    const task = coreApiTask();

    await task.load();

    expect(task.get(POLL_INTERVAL_SETTINGS).standings).toBe(10000);
    expect(await getPrisma().platformRuntimeConfig.count()).toBe(0);
    expect(await getPrisma().platformRuntimeConfigHistory.count()).toBe(0);
  });

  it('a poll interval saved through the API on one task reaches a second task at its next refresh', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Settings Root Admin', isRootAdmin: true });
    const secondTask = coreApiTask();
    await secondTask.load();

    const saved = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/platform/poll-intervals',
      headers: rootAdmin.headers,
      payload: { standings: 15000 },
    });

    expect(saved.statusCode).toBe(200);
    expect(secondTask.get(POLL_INTERVAL_SETTINGS).standings).toBe(10000);
    await secondTask.refresh();
    expect(secondTask.get(POLL_INTERVAL_SETTINGS).standings).toBe(15000);
  });

  it('a sport override saved on one task survives a global schedule update made on a second task before its refresh', async () => {
    const admin = await createTestUser({ displayName: 'Settings Race Admin', isRootAdmin: true });
    const taskA = coreApiTask();
    const taskB = coreApiTask();
    await taskA.load();
    await taskB.load();

    await new IngestionConfigService(taskA).setPerSportOverride('GOLF', { eventLiveScores: { intervalSeconds: 20 } }, admin.user.id);
    await new IngestionConfigService(taskB).updateConfig({ eventLiveScores: { intervalSeconds: 45 } }, admin.user.id);

    const stored = await getPrisma().platformRuntimeConfig.findUnique({ where: { configKey: INGESTION_SCHEDULE_SETTINGS.key } });
    expect(stored?.configJson).toEqual(expect.objectContaining({
      eventLiveScores: { enabled: true, intervalSeconds: 45 },
      perSportOverrides: { GOLF: { eventLiveScores: { intervalSeconds: 20 } } },
    }));
  });

  it('records each save in the history with the previous value, the new value and the admin who saved it', async () => {
    const admin = await createTestUser({ displayName: 'Settings History Admin', isRootAdmin: true });
    const task = coreApiTask();
    await task.load();
    const defaults = task.get(POLL_INTERVAL_SETTINGS);

    await task.save(POLL_INTERVAL_SETTINGS, { ...defaults, draft: 12000 }, { changedById: admin.user.id });
    await task.save(POLL_INTERVAL_SETTINGS, { ...defaults, draft: 14000 }, { changedById: admin.user.id });

    const history = await getPrisma().platformRuntimeConfigHistory.findMany({
      where: { configKey: POLL_INTERVAL_SETTINGS.key },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.map((change) => [
      (change.previousJson as { draft?: number } | null)?.draft ?? null,
      (change.newJson as { draft: number }).draft,
      change.changedById,
    ])).toEqual([
      [null, 12000, admin.user.id],
      [12000, 14000, admin.user.id],
    ]);
  });

  it('refuses a save against a version another task has replaced, leaving the stored value and history as that task left them', async () => {
    const admin = await createTestUser({ displayName: 'Settings Conflict Admin', isRootAdmin: true });
    const first = coreApiTask();
    const second = coreApiTask();
    await first.load();
    await second.load();
    const defaults = first.get(POLL_INTERVAL_SETTINGS);
    const seenBySecond = second.getState(POLL_INTERVAL_SETTINGS).updatedAt;

    await first.save(POLL_INTERVAL_SETTINGS, { ...defaults, draft: 12000 }, { changedById: admin.user.id, expectedUpdatedAt: null });

    await expect(second.save(POLL_INTERVAL_SETTINGS, { ...defaults, draft: 20000 }, {
      changedById: admin.user.id,
      expectedUpdatedAt: seenBySecond,
    })).rejects.toBeInstanceOf(SettingsConflictError);
    const stored = await getPrisma().platformRuntimeConfig.findUnique({ where: { configKey: POLL_INTERVAL_SETTINGS.key } });
    expect((stored?.configJson as { draft: number }).draft).toBe(12000);
    expect(await getPrisma().platformRuntimeConfigHistory.count()).toBe(1);
  });

  it('an invalid stored value is served as the defaults and the row is left exactly as it was', async () => {
    await getPrisma().platformRuntimeConfig.create({
      data: { configKey: POLL_INTERVAL_SETTINGS.key, configJson: { standings: 'fast' } },
    });
    const task = coreApiTask();

    await task.load();

    expect(task.get(POLL_INTERVAL_SETTINGS).standings).toBe(10000);
    const stored = await getPrisma().platformRuntimeConfig.findUnique({ where: { configKey: POLL_INTERVAL_SETTINGS.key } });
    expect(stored?.configJson).toEqual({ standings: 'fast' });
  });
});

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../packages/core-api/prisma/migrations/20261007190000_platform_runtime_config_history/migration.sql'),
  'utf8',
);

/** The migration's statements, comments stripped. No statement contains a semicolon of its own. */
const MIGRATION_STATEMENTS = MIGRATION_SQL
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

/** Seeds pre-migration settings rows in a scratch schema, runs the migration there, and reads them back. */
async function migrate(rows: Record<string, unknown>): Promise<Record<string, unknown>> {
  const schema = `mig450_${randomUUID().replace(/-/g, '')}`;
  return getPrisma().$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    await tx.$executeRawUnsafe(`CREATE TABLE "platform_runtime_configs" (
      "config_key" varchar(100) PRIMARY KEY,
      "config_json" jsonb NOT NULL
    )`);
    for (const [configKey, configJson] of Object.entries(rows)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "platform_runtime_configs" ("config_key", "config_json") VALUES ($1, $2::jsonb)`,
        configKey,
        JSON.stringify(configJson),
      );
    }

    for (const statement of MIGRATION_STATEMENTS) {
      await tx.$executeRawUnsafe(statement);
    }

    const migrated = await tx.$queryRawUnsafe<Array<{ config_key: string; config_json: unknown }>>(
      `SELECT "config_key", "config_json" FROM "platform_runtime_configs"`,
    );
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    return Object.fromEntries(migrated.map((row) => [row.config_key, row.config_json]));
  });
}

describe('#450 migration: retired feed policies leave the stored ingestion schedule', () => {
  it('removes the policies retired by #125 and #126 everywhere, drops an override left empty, and keeps every live setting', async () => {
    const migrated = await migrate({
      INGESTION_SCHEDULE_CONFIG: {
        scheduledSports: ['GOLF'],
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
        eventParticipants: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
        participantRankings: { enabled: true, intervalMinutes: 1440 },
        eventLiveScores: { enabled: true, intervalSeconds: 45 },
        eventResults: { enabled: false, intervalMinutes: 30 },
        perSportOverrides: {
          GOLF: { participantRankings: { enabled: false }, eventLiveScores: { intervalSeconds: 20 } },
          TENNIS: { participantRankings: { intervalMinutes: 60 } },
          NFL: { eventSchedule: { enabled: false }, eventResults: { intervalMinutes: 10 } },
        },
      },
    });

    expect(migrated.INGESTION_SCHEDULE_CONFIG).toEqual({
      scheduledSports: ['GOLF'],
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventParticipants: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
      eventLiveScores: { enabled: true, intervalSeconds: 45 },
      perSportOverrides: { GOLF: { eventLiveScores: { intervalSeconds: 20 } } },
    });
  });

  it('leaves an already clean ingestion schedule and every other settings group untouched', async () => {
    const clean = {
      scheduledSports: ['GOLF'],
      eventLiveScores: { enabled: true, intervalSeconds: 45 },
      perSportOverrides: { GOLF: { eventLiveScores: { intervalSeconds: 20 } } },
    };
    const poll = { standings: 10000, draft: 10000, eventSchedule: 'not an ingestion key here' };

    const migrated = await migrate({ INGESTION_SCHEDULE_CONFIG: clean, POLL_INTERVAL_CONFIG: poll });

    expect(migrated).toEqual({ INGESTION_SCHEDULE_CONFIG: clean, POLL_INTERVAL_CONFIG: poll });
  });
});

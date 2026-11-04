/**
 * #450 — the settings registry against real Postgres: what a save stores and records, how a
 * save on one core-api task reaches another, and that booting writes nothing.
 *
 * Production runs two core-api tasks on one database. Each case that needs a second task builds
 * its own `AppSettingsService` on the shared Prisma client; the refresh that would run on its
 * 30-second timer is called directly.
 */
import { PrismaPlatformRuntimeConfigRepository } from '../../../packages/core-api/src/adapters';
import {
  AppSettingsService,
  SettingsConflictError,
} from '../../../packages/core-api/src/modules/platform/app-settings-service';
import { EMAIL_SETTINGS } from '../../../packages/core-api/src/modules/email/email-settings';
import {
  INGESTION_SCHEDULE_SETTINGS,
  IngestionConfigService,
} from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { SETTINGS_GROUPS } from '../../../packages/core-api/src/modules/platform/settings-groups';
import {
  SettingsChangeListSchema,
  SettingsGroupListSchema,
  SettingsGroupSchema,
  type SettingsGroup,
} from '@poolmaster/shared/dto/settings.dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

/** Resolves once some backend in the test database is waiting on a lock another one holds. */
async function waitForBlockedBackend(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [{ waiting }] = await getPrisma().$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`;
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('No backend blocked on a lock within 5 seconds');
}

function coreApiTask(): AppSettingsService {
  return new AppSettingsService({
    repository: new PrismaPlatformRuntimeConfigRepository(getAppPrisma()),
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

    expect(task.get(EMAIL_SETTINGS).allowedRecipients).toEqual([]);
    expect(await getPrisma().platformRuntimeConfig.count()).toBe(0);
    expect(await getPrisma().platformRuntimeConfigHistory.count()).toBe(0);
  });

  it('a value saved through the API on one task reaches a second task at its next refresh', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Settings Root Admin', isRootAdmin: true });
    const secondTask = coreApiTask();
    await secondTask.load();

    const saved = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/platform/settings/EMAIL_CONFIG',
      headers: rootAdmin.headers,
      payload: { key: 'EMAIL_CONFIG', value: { ...secondTask.get(EMAIL_SETTINGS), allowedRecipients: ['help@example.test'] }, expectedUpdatedAt: null },
    });

    expect(saved.statusCode).toBe(200);
    expect(secondTask.get(EMAIL_SETTINGS).allowedRecipients).toEqual([]);
    await secondTask.refresh();
    expect(secondTask.get(EMAIL_SETTINGS).allowedRecipients).toEqual(['help@example.test']);
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
    const defaults = task.get(EMAIL_SETTINGS);

    await task.save(EMAIL_SETTINGS, { ...defaults, allowedRecipients: ['first@example.test'] }, { changedById: admin.user.id });
    await task.save(EMAIL_SETTINGS, { ...defaults, allowedRecipients: ['second@example.test'] }, { changedById: admin.user.id });

    const history = await getPrisma().platformRuntimeConfigHistory.findMany({
      where: { configKey: EMAIL_SETTINGS.key },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.map((change) => [
      (change.previousJson as { allowedRecipients?: string[] } | null)?.allowedRecipients ?? null,
      (change.newJson as { allowedRecipients: string[] }).allowedRecipients,
      change.changedById,
    ])).toEqual([
      [null, ['first@example.test'], admin.user.id],
      [['first@example.test'], ['second@example.test'], admin.user.id],
    ]);
  });

  it('refuses a save against a version another task has replaced, leaving the stored value and history as that task left them', async () => {
    const admin = await createTestUser({ displayName: 'Settings Conflict Admin', isRootAdmin: true });
    const first = coreApiTask();
    const second = coreApiTask();
    await first.load();
    await second.load();
    const defaults = first.get(EMAIL_SETTINGS);
    const seenBySecond = second.getState(EMAIL_SETTINGS).updatedAt;

    await first.save(EMAIL_SETTINGS, { ...defaults, allowedRecipients: ['first@example.test'] }, { changedById: admin.user.id, expectedUpdatedAt: null });

    await expect(second.save(EMAIL_SETTINGS, { ...defaults, allowedRecipients: ['second@example.test'] }, {
      changedById: admin.user.id,
      expectedUpdatedAt: seenBySecond,
    })).rejects.toBeInstanceOf(SettingsConflictError);
    const stored = await getPrisma().platformRuntimeConfig.findUnique({ where: { configKey: EMAIL_SETTINGS.key } });
    expect((stored?.configJson as { allowedRecipients: string[] }).allowedRecipients).toEqual(['first@example.test']);
    expect(await getPrisma().platformRuntimeConfigHistory.count()).toBe(1);
  });

  it('a first save that loses the race to another first save answers with a conflict naming the winner, and writes nothing', async () => {
    const admin = await createTestUser({ displayName: 'Settings Race Admin', isRootAdmin: true });
    const repository = new PrismaPlatformRuntimeConfigRepository(getAppPrisma());
    // The other task's first save inserts the row and holds its transaction open, so this
    // save finds no row to lock and meets that insert at the unique key once it commits.
    let release!: () => void;
    let inserted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const insertDone = new Promise<void>((resolve) => { inserted = resolve; });
    const winner = getPrisma().$transaction(async (tx) => {
      await tx.platformRuntimeConfig.create({
        data: { configKey: EMAIL_SETTINGS.key, configJson: { allowedRecipients: ['first@example.test'] }, updatedById: admin.user.id },
      });
      inserted();
      await held;
    });
    await insertDone;

    const losing = repository.save({
      configKey: EMAIL_SETTINGS.key,
      configJson: { allowedRecipients: ['second@example.test'] },
      changedById: admin.user.id,
      expectedUpdatedAt: null,
    });
    // Release the winner only once the losing save is waiting on its lock, so the loser meets
    // the row at the unique key rather than finding it committed.
    await waitForBlockedBackend();
    release();
    await winner;
    const result = await losing;

    expect(result.status).toBe('conflict');
    expect(result.status === 'conflict' && result.current?.configJson).toEqual({ allowedRecipients: ['first@example.test'] });
    expect(await getPrisma().platformRuntimeConfigHistory.count()).toBe(0);
  });

  it('an invalid stored value is served as the defaults and the row is left exactly as it was', async () => {
    await getPrisma().platformRuntimeConfig.create({
      data: { configKey: EMAIL_SETTINGS.key, configJson: { enabled: 'yes' } },
    });
    const task = coreApiTask();

    await task.load();

    expect(task.get(EMAIL_SETTINGS).allowedRecipients).toEqual([]);
    const stored = await getPrisma().platformRuntimeConfig.findUnique({ where: { configKey: EMAIL_SETTINGS.key } });
    expect(stored?.configJson).toEqual({ enabled: 'yes' });
  });
});

describe('settings routes (contract verification)', () => {
  it('lists every group to a root admin and refuses everyone else', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Settings List Admin', isRootAdmin: true });
    const member = await createTestUser({ displayName: 'Settings List Member' });

    const list = await getApp().inject({ method: 'GET', url: '/api/v1/platform/settings', headers: rootAdmin.headers });
    const refused = await getApp().inject({ method: 'GET', url: '/api/v1/platform/settings', headers: member.headers });

    expect(list.statusCode).toBe(200);
    expect(SettingsGroupListSchema.safeParse(list.json()).success).toBe(true);
    expect(list.json<{ groups: SettingsGroup[] }>().groups.map((group) => group.key))
      .toEqual(['INGESTION_SCHEDULE_CONFIG', 'EMAIL_CONFIG', 'BUDGET_PRICING_CONFIG', 'PLAN_CONFIG', 'BILLING_CONFIG']);
    expect(refused.statusCode).toBe(403);
  });

  it('saves a whole value, names the admin, records it in the history, and refuses a second save against the old version with 409', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Settings Save Admin', firstName: 'Sam', lastName: 'Saver', isRootAdmin: true,
    });
    const before = (await getApp().inject({
      method: 'GET', url: '/api/v1/platform/settings/EMAIL_CONFIG', headers: rootAdmin.headers,
    })).json<SettingsGroup>();
    const save = (recipient: string) => getApp().inject({
      method: 'PUT',
      url: '/api/v1/platform/settings/EMAIL_CONFIG',
      headers: rootAdmin.headers,
      payload: { key: 'EMAIL_CONFIG', value: { ...before.value, allowedRecipients: [recipient] }, expectedUpdatedAt: before.updatedAt },
    });

    const saved = await save('first@example.test');
    const stale = await save('second@example.test');
    const history = await getApp().inject({
      method: 'GET', url: '/api/v1/platform/settings/EMAIL_CONFIG/history', headers: rootAdmin.headers,
    });

    expect(saved.statusCode).toBe(200);
    expect(SettingsGroupSchema.safeParse(saved.json()).success).toBe(true);
    const savedGroup = saved.json<SettingsGroup>();
    expect(savedGroup.source).toBe('stored');
    expect(savedGroup.updatedBy).toEqual({ id: rootAdmin.user.id, name: 'Sam Saver' });
    expect(savedGroup.value).toEqual({ ...before.value, allowedRecipients: ['first@example.test'] });
    expect(stale.statusCode).toBe(409);
    expect(ErrorEnvelopeSchema.safeParse(stale.json()).success).toBe(true);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('SETTINGS_CONFLICT');
    expect(history.statusCode).toBe(200);
    expect(SettingsChangeListSchema.safeParse(history.json()).success).toBe(true);
    expect(history.json<{ changes: Array<{ newValue: { allowedRecipients: string[] } }> }>().changes.map((change) => change.newValue.allowedRecipients))
      .toEqual([['first@example.test']]);
  });

  it('refuses an invalid value with 400 and an unknown key with 404, storing nothing', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Settings Invalid Admin', isRootAdmin: true });

    const invalid = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/platform/settings/EMAIL_CONFIG',
      headers: rootAdmin.headers,
      payload: {
        key: 'EMAIL_CONFIG',
        value: {
          enabled: true,
          allowedRecipients: ['not an address'],
          templates: { LEAGUE_MEMBER_INVITE: true, LEAGUE_JOIN_SUCCESS: true, CONTEST_ENTRY_COMPLETED: true, CONTEST_STARTED_SUMMARY: true },
        },
        expectedUpdatedAt: null,
      },
    });
    const unknown = await getApp().inject({
      method: 'POST', url: '/api/v1/platform/settings/NOT_A_GROUP/reset', headers: withoutJsonBodyHeaders(rootAdmin.headers),
    });

    expect(invalid.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(invalid.json()).success).toBe(true);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe('SETTINGS_GROUP_NOT_FOUND');
    expect(await getPrisma().platformRuntimeConfig.count()).toBe(0);
  });

  it('saves the plans settings when no cap falls as the plan rises, and refuses with 400 a cap that falls or a cap of zero, storing nothing', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Plan Settings Admin', isRootAdmin: true });
    const before = (await getApp().inject({
      method: 'GET', url: '/api/v1/platform/settings/PLAN_CONFIG', headers: rootAdmin.headers,
    })).json<SettingsGroup>();
    if (before.key !== 'PLAN_CONFIG') throw new Error('Expected the PLAN_CONFIG group.');
    const save = (caps: object) => getApp().inject({
      method: 'PUT',
      url: '/api/v1/platform/settings/PLAN_CONFIG',
      headers: rootAdmin.headers,
      payload: { key: 'PLAN_CONFIG', value: { ...before.value, caps: { ...before.value.caps, ...caps } }, expectedUpdatedAt: null },
    });

    const falling = await save({ ENTRIES_PER_CONTEST: { FREE: 20, PRO: 10, PREMIUM: 100, PLATINUM: 500 } });
    const zero = await save({ SPORTS_LEAGUES_PER_YEAR: { FREE: 0, PRO: 3, PREMIUM: 10, PLATINUM: 50 } });
    const storedAfterRefusals = await getPrisma().platformRuntimeConfig.count();
    const saved = await save({ ENTRIES_PER_CONTEST: { FREE: 25, PRO: 25, PREMIUM: null, PLATINUM: null } });

    expect(falling.statusCode).toBe(400);
    expect(falling.json<{ error: { code: string } }>().error.code).toBe('SETTINGS_INVALID');
    expect(zero.statusCode).toBe(400);
    expect(storedAfterRefusals).toBe(0);
    expect(saved.statusCode).toBe(200);
    expect(SettingsGroupSchema.safeParse(saved.json()).success).toBe(true);
    expect(saved.json<SettingsGroup>().value).toEqual({
      ...before.value,
      caps: { ...before.value.caps, ENTRIES_PER_CONTEST: { FREE: 25, PRO: 25, PREMIUM: null, PLATINUM: null } },
    });
  });

  it('resets a group to its defaults, stored and recorded like any other save', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Settings Reset Admin', isRootAdmin: true });

    const reset = await getApp().inject({
      method: 'POST', url: '/api/v1/platform/settings/INGESTION_SCHEDULE_CONFIG/reset', headers: withoutJsonBodyHeaders(rootAdmin.headers),
    });

    expect(reset.statusCode).toBe(200);
    expect(SettingsGroupSchema.safeParse(reset.json()).success).toBe(true);
    expect(reset.json<SettingsGroup>()).toEqual(expect.objectContaining({ source: 'stored' }));
    expect(reset.json<SettingsGroup>().value).toEqual(reset.json<SettingsGroup>().defaults);
    expect(await getPrisma().platformRuntimeConfigHistory.count()).toBe(1);
  });
});

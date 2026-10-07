import { expect } from '@jest/globals';
import type { User } from '@poolmaster/shared/domain';
import { SettingsGroupKeySchema } from '@poolmaster/shared/dto/settings.dto';
import { AppSettingsService } from '../../../packages/core-api/src/modules/platform/app-settings-service';
import { PlatformSettingsService } from '../../../packages/core-api/src/modules/platform/platform-settings-service';
import { SETTINGS_GROUPS } from '../../../packages/core-api/src/modules/platform/settings-groups';
import { toSettingsGroupDto } from '../../../packages/core-api/src/mappers/platform-settings.mapper';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryRuntimeConfigs } from '../../support/in-memory-runtime-configs';
import { fakeUserRepo } from '../../support/repo-fakes';

const ADMIN: User = {
  id: '6f7c1c55-58a4-4bd4-8a2a-0b8e3f1f4a01',
  email: 'admin@example.test',
  username: 'admin',
  firstName: 'Ada',
  lastName: 'Admin',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

async function buildService() {
  const runtimeConfigs = inMemoryRuntimeConfigs();
  const settings = new AppSettingsService({
    repository: runtimeConfigs,
    groups: SETTINGS_GROUPS,
    env: { POOLMASTER_ENVIRONMENT: 'production' },
    logger: fakeLogger(),
  });
  await settings.load();
  const users = fakeUserRepo({
    findById: async (id) => (id === ADMIN.id ? ADMIN : null),
  });
  return { runtimeConfigs, service: new PlatformSettingsService({ settings, runtimeConfigs, users, logger: fakeLogger() }) };
}

describe('PlatformSettingsService', () => {
  it('lists every registered group in registry order, unsaved groups showing their defaults and no author', async () => {
    const { service } = await buildService();

    const groups = await service.list();

    expect(groups.map((view) => view.group.key)).toEqual(['POLL_INTERVAL_CONFIG', 'INGESTION_SCHEDULE_CONFIG', 'EMAIL_CONFIG']);
    expect(groups[0]).toEqual(expect.objectContaining({
      state: expect.objectContaining({ source: 'defaults', updatedAt: null }),
      updatedBy: null,
    }));
  });

  it('names the admin who saved a group, by full name', async () => {
    const { service } = await buildService();
    const current = await service.get('POLL_INTERVAL_CONFIG');

    const saved = await service.save('POLL_INTERVAL_CONFIG', {
      key: 'POLL_INTERVAL_CONFIG',
      value: { ...(current.state.value as object), draft: 12000 },
      expectedUpdatedAt: null,
    }, ADMIN.id);

    expect(saved.state.source).toBe('stored');
    expect(saved.updatedBy).toEqual({ id: ADMIN.id, name: 'Ada Admin' });
  });

  it('refuses an unknown group key with a 404 and stores nothing', async () => {
    const { runtimeConfigs, service } = await buildService();

    await expect(service.get('NOT_A_GROUP')).rejects.toMatchObject({ statusCode: 404, code: 'SETTINGS_GROUP_NOT_FOUND' });
    await expect(service.reset('NOT_A_GROUP', ADMIN.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(runtimeConfigs.rows.size).toBe(0);
  });

  it('refuses a body for one group sent to another group\'s path with a 400 and stores nothing', async () => {
    const { runtimeConfigs, service } = await buildService();

    await expect(service.save('INGESTION_SCHEDULE_CONFIG', {
      key: 'POLL_INTERVAL_CONFIG',
      value: {},
      expectedUpdatedAt: null,
    }, ADMIN.id)).rejects.toMatchObject({ statusCode: 400, code: 'SETTINGS_KEY_MISMATCH' });
    expect(runtimeConfigs.rows.size).toBe(0);
  });

  it('returns a group\'s changes newest first, each with its author, and an unknown author as null', async () => {
    const { service } = await buildService();
    const defaults = (await service.get('POLL_INTERVAL_CONFIG')).state.defaults as object;
    await service.save('POLL_INTERVAL_CONFIG', {
      key: 'POLL_INTERVAL_CONFIG', value: { ...defaults, draft: 12000 }, expectedUpdatedAt: null,
    }, ADMIN.id);
    await service.reset('POLL_INTERVAL_CONFIG', '9a1f3c0e-0000-4000-8000-000000000000');

    const history = await service.history('POLL_INTERVAL_CONFIG');

    expect(history.map((view) => [(view.change.newJson as { draft: number }).draft, view.changedBy?.name ?? null]))
      .toEqual([[10000, null], [12000, 'Ada Admin']]);
  });
});

describe('the settings contract and the registry agree', () => {
  it('the published key enum names exactly the registered groups', () => {
    expect([...SettingsGroupKeySchema.options].sort()).toEqual(SETTINGS_GROUPS.map((group) => group.key).sort());
  });

  it('every registered group\'s value and defaults pass the published per-key schema', async () => {
    const { service } = await buildService();

    for (const view of await service.list()) {
      expect(() => toSettingsGroupDto(view)).not.toThrow();
    }
  });
});

import { expect } from '@jest/globals';
import type { User } from '@poolmaster/shared/domain';
import { SettingsGroupKeySchema } from '@poolmaster/shared/dto/settings.dto';
import { AppSettingsService } from '../../../packages/core-api/src/modules/platform/app-settings-service';
import { PlatformSettingsService } from '../../../packages/core-api/src/modules/platform/platform-settings-service';
import { SETTINGS_GROUPS } from '../../../packages/core-api/src/modules/platform/settings-groups';
import { toSettingsChangeDto, toSettingsGroupDto } from '../../../packages/core-api/src/mappers/platform-settings.mapper';
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
  const logger = fakeLogger();
  const settings = new AppSettingsService({
    repository: runtimeConfigs,
    groups: SETTINGS_GROUPS,
    env: { POOLMASTER_ENVIRONMENT: 'prod' },
    logger: fakeLogger(),
  });
  await settings.load();
  const users = fakeUserRepo({
    findById: async (id) => (id === ADMIN.id ? ADMIN : null),
  });
  return { logger, runtimeConfigs, service: new PlatformSettingsService({ settings, runtimeConfigs, users, logger }) };
}

describe('PlatformSettingsService', () => {
  it('lists every registered group in registry order, unsaved groups showing their defaults and no author', async () => {
    const { service } = await buildService();

    const groups = await service.list();

    expect(groups.map((view) => view.group.key)).toEqual(['INGESTION_SCHEDULE_CONFIG', 'EMAIL_CONFIG', 'BUDGET_PRICING_CONFIG']);
    expect(groups[0]).toEqual(expect.objectContaining({
      state: expect.objectContaining({ source: 'defaults', updatedAt: null }),
      updatedBy: null,
    }));
  });

  it('names the admin who saved a group, by full name', async () => {
    const { service } = await buildService();
    const current = await service.get('EMAIL_CONFIG');

    const saved = await service.save('EMAIL_CONFIG', {
      key: 'EMAIL_CONFIG',
      value: { ...(current.state.value as object), replyTo: 'help@example.test' },
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
      key: 'EMAIL_CONFIG',
      value: {},
      expectedUpdatedAt: null,
    }, ADMIN.id)).rejects.toMatchObject({ statusCode: 400, code: 'SETTINGS_KEY_MISMATCH' });
    expect(runtimeConfigs.rows.size).toBe(0);
  });

  it('returns a group\'s changes newest first, each with its author, and an unknown author as null', async () => {
    const { service } = await buildService();
    const defaults = (await service.get('EMAIL_CONFIG')).state.defaults as object;
    await service.save('EMAIL_CONFIG', {
      key: 'EMAIL_CONFIG', value: { ...defaults, replyTo: 'help@example.test' }, expectedUpdatedAt: null,
    }, ADMIN.id);
    await service.reset('EMAIL_CONFIG', '9a1f3c0e-0000-4000-8000-000000000000');

    const history = await service.history('EMAIL_CONFIG');

    expect(history.map((view) => [(view.change.newJson as { replyTo: string | null }).replyTo, view.changedBy?.name ?? null]))
      .toEqual([[null, null], ['help@example.test', 'Ada Admin']]);
  });

  it('publishes each change with its values typed by the group\'s schema, the first save\'s previous value as null', async () => {
    const { service } = await buildService();
    const defaults = (await service.get('EMAIL_CONFIG')).state.defaults as object;
    await service.save('EMAIL_CONFIG', {
      key: 'EMAIL_CONFIG', value: { ...defaults, replyTo: 'help@example.test' }, expectedUpdatedAt: null,
    }, ADMIN.id);

    const [change] = (await service.history('EMAIL_CONFIG')).map(toSettingsChangeDto);

    expect(change.key).toBe('EMAIL_CONFIG');
    expect(change.previousValue).toBeNull();
    expect(change.newValue).toEqual(expect.objectContaining({ replyTo: 'help@example.test' }));
  });

  it('leaves a change whose stored value no longer validates out of the history and logs it, keeping the valid ones', async () => {
    const { logger, runtimeConfigs, service } = await buildService();
    const defaults = (await service.get('EMAIL_CONFIG')).state.defaults as object;
    await service.save('EMAIL_CONFIG', {
      key: 'EMAIL_CONFIG', value: { ...defaults, replyTo: 'help@example.test' }, expectedUpdatedAt: null,
    }, ADMIN.id);
    runtimeConfigs.history.push({
      id: 'change-old-release',
      configKey: 'EMAIL_CONFIG',
      previousJson: null,
      newJson: { enabled: true },
      changedById: null,
      changedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const history = await service.history('EMAIL_CONFIG');

    expect(history.map((view) => view.change.id)).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'adminSettings.history.changeSkipped' }),
      expect.any(String),
    );
  });

  it('refuses to publish a stored change whose value does not match its group\'s schema, rather than passing it through untyped', () => {
    expect(() => toSettingsChangeDto({
      change: {
        id: '6f7c1c55-58a4-4bd4-8a2a-0b8e3f1f4a02',
        configKey: 'EMAIL_CONFIG',
        previousJson: null,
        newJson: { enabled: 'yes' },
        changedById: null,
        changedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      changedBy: null,
    })).toThrow();
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

import { expect } from '@jest/globals';
import { z } from 'zod';
import {
  AppSettingsService,
  SettingsConflictError,
  SettingsValidationError,
} from '../../../packages/core-api/src/modules/platform/app-settings-service';
import {
  INGESTION_SCHEDULE_SETTINGS,
  IngestionConfigService,
} from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { defineSettingsGroup } from '../../../packages/core-api/src/modules/platform/settings-group';
import type { SettingsGroup } from '../../../packages/core-api/src/modules/platform/settings-group';
import { SETTINGS_GROUPS } from '../../../packages/core-api/src/modules/platform/settings-groups';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryRuntimeConfigs } from '../../support/in-memory-runtime-configs';
import type { InMemoryRuntimeConfigs } from '../../support/in-memory-runtime-configs';

const SampleSchema = z.object({
  enabled: z.boolean(),
  limit: z.number().int().min(1),
  label: z.string().nullable(),
});
type Sample = z.infer<typeof SampleSchema>;

function sampleGroup(onChange?: (next: Sample, previous: Sample) => void): SettingsGroup<Sample> {
  return defineSettingsGroup<Sample>({
    key: 'SAMPLE_CONFIG',
    title: 'Sample',
    description: 'A group for exercising the settings service.',
    schema: SampleSchema,
    defaults: (env) => ({ enabled: env.POOLMASTER_ENVIRONMENT !== 'qa', limit: 5, label: null }),
    onChange,
  });
}

function settingsFor(
  repository: InMemoryRuntimeConfigs,
  groups: readonly SettingsGroup<unknown>[],
  env: Record<string, string> = { POOLMASTER_ENVIRONMENT: 'prod' },
  logger = fakeLogger(),
) {
  return new AppSettingsService({ repository, groups, env, logger });
}

const asGroups = (...groups: SettingsGroup<Sample>[]): SettingsGroup<unknown>[] => groups;

describe('AppSettingsService', () => {
  it('serves the defaults, marked as defaults, when nothing is stored, and boot writes nothing', async () => {
    const repository = inMemoryRuntimeConfigs();
    const group = sampleGroup();
    const settings = settingsFor(repository, asGroups(group));

    await settings.load();

    expect(settings.get(group)).toEqual({ enabled: true, limit: 5, label: null });
    expect(settings.getState(group)).toEqual(expect.objectContaining({ source: 'defaults', updatedAt: null }));
    expect(repository.rows.size).toBe(0);
    expect(repository.history).toHaveLength(0);
  });

  it('computes defaults from the environment, so the same group can default differently on QA', async () => {
    const group = sampleGroup();
    const settings = settingsFor(inMemoryRuntimeConfigs(), asGroups(group), { POOLMASTER_ENVIRONMENT: 'qa' });

    await settings.load();

    expect(settings.get(group).enabled).toBe(false);
  });

  it('fills a field missing from a stored payload with its default instead of rejecting the row', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put('SAMPLE_CONFIG', { enabled: false });
    const group = sampleGroup();
    const settings = settingsFor(repository, asGroups(group));

    await settings.load();

    expect(settings.get(group)).toEqual({ enabled: false, limit: 5, label: null });
    expect(settings.getState(group).source).toBe('stored');
  });

  it('drops keys the group no longer has from a stored payload and keeps the rest', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put('SAMPLE_CONFIG', { enabled: false, limit: 9, label: 'x', retiredField: true });
    const group = sampleGroup();
    const settings = settingsFor(repository, asGroups(group));

    await settings.load();

    expect(settings.get(group)).toEqual({ enabled: false, limit: 9, label: 'x' });
  });

  it('uses the defaults for an invalid stored payload, logs it once, and leaves the row for an admin to fix', async () => {
    const repository = inMemoryRuntimeConfigs();
    const stored = repository.put('SAMPLE_CONFIG', { enabled: false, limit: 0, label: null });
    const group = sampleGroup();
    const logger = fakeLogger();
    const settings = settingsFor(repository, asGroups(group), undefined, logger);

    await settings.load();
    await settings.refresh();

    expect(settings.get(group)).toEqual({ enabled: true, limit: 5, label: null });
    expect(settings.getState(group)).toEqual(expect.objectContaining({
      source: 'defaults',
      updatedAt: stored.updatedAt,
    }));
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(repository.rows.get('SAMPLE_CONFIG')?.configJson).toEqual({ enabled: false, limit: 0, label: null });
    expect(repository.history).toHaveLength(0);
  });

  it('picks up a value another task saved at its next refresh, not before', async () => {
    const repository = inMemoryRuntimeConfigs();
    const group = sampleGroup();
    const saver = settingsFor(repository, asGroups(group));
    const reader = settingsFor(repository, asGroups(group));
    await saver.load();
    await reader.load();

    await saver.save(group, { enabled: true, limit: 7, label: null }, { changedById: 'admin-1' });

    expect(saver.get(group).limit).toBe(7);
    expect(reader.get(group).limit).toBe(5);
    await reader.refresh();
    expect(reader.get(group).limit).toBe(7);
  });

  it('keeps the last loaded values and warns when a refresh cannot reach the database', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put('SAMPLE_CONFIG', { enabled: false, limit: 3, label: null });
    const group = sampleGroup();
    const logger = fakeLogger();
    const settings = settingsFor(repository, asGroups(group), undefined, logger);
    await settings.load();

    repository.failNextRead();
    await settings.refresh();

    expect(settings.get(group).limit).toBe(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appSettings.refresh.failed' }),
      expect.any(String),
    );
  });

  it('records each save in the history with the previous value, the new value and who saved it', async () => {
    const repository = inMemoryRuntimeConfigs();
    const group = sampleGroup();
    const settings = settingsFor(repository, asGroups(group));
    await settings.load();

    await settings.save(group, { enabled: true, limit: 7, label: null }, { changedById: 'admin-1' });
    await settings.save(group, { enabled: false, limit: 7, label: null }, { changedById: 'admin-2' });

    expect(repository.history).toEqual([
      expect.objectContaining({ previousJson: null, newJson: { enabled: true, limit: 7, label: null }, changedById: 'admin-1' }),
      expect.objectContaining({
        previousJson: { enabled: true, limit: 7, label: null },
        newJson: { enabled: false, limit: 7, label: null },
        changedById: 'admin-2',
      }),
    ]);
  });

  it('refuses a save made against a version someone else has since replaced, and stores nothing', async () => {
    const repository = inMemoryRuntimeConfigs();
    const group = sampleGroup();
    const first = settingsFor(repository, asGroups(group));
    const second = settingsFor(repository, asGroups(group));
    await first.load();
    await second.load();
    const seenBySecond = second.getState(group).updatedAt;

    await first.save(group, { enabled: true, limit: 7, label: null }, { changedById: 'admin-1', expectedUpdatedAt: null });
    const attempt = second.save(group, { enabled: true, limit: 9, label: null }, {
      changedById: 'admin-2',
      expectedUpdatedAt: seenBySecond,
    });

    await expect(attempt).rejects.toBeInstanceOf(SettingsConflictError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 409, code: 'SETTINGS_CONFLICT' });
    expect(repository.rows.get('SAMPLE_CONFIG')?.configJson).toEqual({ enabled: true, limit: 7, label: null });
    expect(repository.history).toHaveLength(1);
  });

  it('a refused save leaves the task holding the version that won, so the next read is current', async () => {
    const repository = inMemoryRuntimeConfigs();
    const group = sampleGroup();
    const first = settingsFor(repository, asGroups(group));
    const second = settingsFor(repository, asGroups(group));
    await first.load();
    await second.load();

    await first.save(group, { enabled: true, limit: 7, label: null }, { changedById: 'admin-1', expectedUpdatedAt: null });
    await expect(second.save(group, { enabled: true, limit: 9, label: null }, {
      changedById: 'admin-2',
      expectedUpdatedAt: null,
    })).rejects.toBeInstanceOf(SettingsConflictError);

    expect(second.get(group).limit).toBe(7);
  });

  it('a partial update applies its change over a save another task made since the last refresh', async () => {
    const repository = inMemoryRuntimeConfigs();
    const group = sampleGroup();
    const first = settingsFor(repository, asGroups(group));
    const second = settingsFor(repository, asGroups(group));
    await first.load();
    await second.load();

    await first.update(group, (current) => ({ ...current, limit: 7 }), { changedById: 'admin-1' });
    await second.update(group, (current) => ({ ...current, label: 'kept' }), { changedById: 'admin-2' });

    expect(repository.rows.get('SAMPLE_CONFIG')?.configJson).toEqual({ enabled: true, limit: 7, label: 'kept' });
    expect(repository.history).toHaveLength(2);
  });

  it('fills a field missing from a nested object of a stored payload with its nested default', async () => {
    const NestedSchema = z.object({ feed: z.object({ enabled: z.boolean(), every: z.number() }) });
    const group = defineSettingsGroup<z.infer<typeof NestedSchema>>({
      key: 'NESTED_CONFIG',
      title: 'Nested',
      description: 'A group with a nested object.',
      schema: NestedSchema,
      defaults: () => ({ feed: { enabled: true, every: 30 } }),
    });
    const repository = inMemoryRuntimeConfigs();
    repository.put('NESTED_CONFIG', { feed: { enabled: false } });
    const settings = new AppSettingsService({ repository, groups: [group], env: {}, logger: fakeLogger() });

    await settings.load();

    expect(settings.get(group)).toEqual({ feed: { enabled: false, every: 30 } });
    expect(settings.getState(group).source).toBe('stored');
  });

  it('rejects an invalid payload with a 400 before anything is stored', async () => {
    const repository = inMemoryRuntimeConfigs();
    const group = sampleGroup();
    const settings = settingsFor(repository, asGroups(group));
    await settings.load();

    await expect(settings.save(group, { enabled: true, limit: 0, label: null }, { changedById: 'admin-1' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'SETTINGS_INVALID' });
    await expect(settings.save(group, { enabled: true, limit: 0, label: null }, { changedById: 'admin-1' }))
      .rejects.toBeInstanceOf(SettingsValidationError);
    expect(repository.rows.size).toBe(0);
  });

  it('runs the change hook when a refresh brings in a different value, and not for the first load or an unchanged one', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put('SAMPLE_CONFIG', { enabled: true, limit: 2, label: null });
    const onChange = jest.fn();
    const group = sampleGroup(onChange);
    const settings = settingsFor(repository, asGroups(group));

    await settings.load();
    await settings.refresh();
    expect(onChange).not.toHaveBeenCalled();

    repository.put('SAMPLE_CONFIG', { enabled: true, limit: 4, label: null });
    await settings.refresh();
    expect(onChange).toHaveBeenCalledWith(
      { enabled: true, limit: 4, label: null },
      { enabled: true, limit: 2, label: null },
    );
  });

  it('hands out copies, so changing a value read from the cache changes nothing stored or served', async () => {
    const group = sampleGroup();
    const settings = settingsFor(inMemoryRuntimeConfigs(), asGroups(group));
    await settings.load();

    const value = settings.get(group);
    value.limit = 99;

    expect(settings.get(group).limit).toBe(5);
  });

  it('logs a change hook that throws and keeps the new value, so one bad hook cannot hold a setting back', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put('SAMPLE_CONFIG', { enabled: true, limit: 2, label: null });
    const logger = fakeLogger();
    const group = sampleGroup(() => { throw new Error('hook broke'); });
    const settings = settingsFor(repository, asGroups(group), undefined, logger);
    await settings.load();

    repository.put('SAMPLE_CONFIG', { enabled: true, limit: 4, label: null });
    await settings.refresh();

    expect(settings.get(group).limit).toBe(4);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'appSettings.onChange.failed' }), expect.any(String));
  });

  it('uses the defaults for a stored value that is not an object at all', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put('SAMPLE_CONFIG', 'not settings');
    const group = sampleGroup();
    const settings = settingsFor(repository, asGroups(group));

    await settings.load();

    expect(settings.get(group)).toEqual({ enabled: true, limit: 5, label: null });
  });

  it('refuses a group it was not given', async () => {
    const settings = settingsFor(inMemoryRuntimeConfigs(), asGroups(sampleGroup()));
    await settings.load();
    const stranger = defineSettingsGroup<Sample>({ ...sampleGroup(), key: 'STRANGER' });

    expect(() => settings.get(stranger)).toThrow('Settings group STRANGER is not registered');
  });

  it('refreshes on its interval once started, starts once however often asked, and stops refreshing when stopped', async () => {
    jest.useFakeTimers();
    try {
      const repository = inMemoryRuntimeConfigs();
      const group = sampleGroup();
      const settings = settingsFor(repository, asGroups(group));
      await settings.load();
      const refresh = jest.spyOn(settings, 'refresh').mockResolvedValue();

      settings.start();
      settings.start();
      jest.advanceTimersByTime(60_000 * 5);
      const whileRunning = refresh.mock.calls.length;
      settings.stop();
      settings.stop();
      jest.advanceTimersByTime(60_000 * 5);

      expect(whileRunning).toBeGreaterThan(0);
      expect(refresh).toHaveBeenCalledTimes(whileRunning);
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses two groups declared with the same key', () => {
    expect(() => settingsFor(inMemoryRuntimeConfigs(), asGroups(sampleGroup(), sampleGroup())))
      .toThrow('Settings group SAMPLE_CONFIG is declared twice');
  });

  it('every registered group has defaults its own schema accepts', () => {
    for (const env of [{ POOLMASTER_ENVIRONMENT: 'qa' }, { POOLMASTER_ENVIRONMENT: 'prod' }]) {
      expect(() => settingsFor(inMemoryRuntimeConfigs(), SETTINGS_GROUPS, env)).not.toThrow();
    }
  });
});

describe('platform config services on the settings registry', () => {
  async function loaded(repository = inMemoryRuntimeConfigs()) {
    const settings = settingsFor(repository, SETTINGS_GROUPS);
    await settings.load();
    return { repository, settings };
  }

  it('ingestion config defaults the scheduled field sync to off, keeps live scores on, syncs event lists every six hours, and has no per-sport overrides', async () => {
    const { settings } = await loaded();
    const service = new IngestionConfigService(settings, fakeLogger());

    const config = await service.getConfig();

    expect(config.FIELD.enabled).toBe(false);
    expect(config.SCORES.enabled).toBe(true);
    expect(config.EVENTS).toEqual({ enabled: true, intervalMinutes: 360 });
    expect(Object.keys(config).sort()).toEqual(['EVENTS', 'FIELD', 'SCORES']);
    await expect(service.resetDefaults('admin-1')).resolves.toEqual(expect.objectContaining({
      FIELD: expect.objectContaining({ enabled: false }),
    }));
  });

  it('a partial update changes only the policies and properties it names, and a reset restores the defaults', async () => {
    const { settings } = await loaded();
    const service = new IngestionConfigService(settings, fakeLogger());

    await expect(
      service.updateConfig({
        SCORES: { intervalSeconds: 45 },
        EVENTS: { intervalMinutes: 120 },
      }, 'admin-1'),
    ).resolves.toEqual(expect.objectContaining({
      SCORES: { enabled: true, intervalSeconds: 45 },
      EVENTS: { enabled: true, intervalMinutes: 120 },
      FIELD: { enabled: false, intervalMinutes: 360, lookaheadDays: 14 },
    }));
    await expect(service.resetDefaults('admin-1')).resolves.toEqual(
      expect.objectContaining({
        EVENTS: { enabled: true, intervalMinutes: 360 },
        SCORES: expect.objectContaining({ intervalSeconds: 300 }),
      }),
    );
  });

  it('a partial update on a task that has not yet refreshed keeps another task\'s save from moments earlier', async () => {
    const repository = inMemoryRuntimeConfigs();
    const taskA = await loaded(repository);
    const taskB = await loaded(repository);
    const ingestionOnA = new IngestionConfigService(taskA.settings, fakeLogger());
    const ingestionOnB = new IngestionConfigService(taskB.settings, fakeLogger());

    await ingestionOnA.updateConfig({ EVENTS: { intervalMinutes: 90 } }, 'admin-1');
    await ingestionOnB.updateConfig({ SCORES: { intervalSeconds: 45 } }, 'admin-2');

    expect(repository.rows.get(INGESTION_SCHEDULE_SETTINGS.key)?.configJson).toEqual(expect.objectContaining({
      SCORES: { enabled: true, intervalSeconds: 45 },
      EVENTS: { enabled: true, intervalMinutes: 90 },
    }));
  });

  it('a stored config loads with its sync settings intact, drops keys the schedule no longer names (the health check, per-sport overrides, the sports list), takes the default for a sync it lacks, and is not rewritten on boot', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put(INGESTION_SCHEDULE_SETTINGS.key, {
      scheduledSports: ['GOLF'],
      healthCheck: { enabled: true, intervalMinutes: 5 },
      FIELD: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
      SCORES: { enabled: true, intervalSeconds: 45 },
      perSportOverrides: { GOLF: { SCORES: { intervalSeconds: 20 } } },
    });
    const { settings } = await loaded(repository);
    const service = new IngestionConfigService(settings, fakeLogger());

    await expect(service.getConfig()).resolves.toEqual({
      EVENTS: { enabled: true, intervalMinutes: 360 },
      FIELD: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
      SCORES: { enabled: true, intervalSeconds: 45 },
    });
    expect(repository.history).toHaveLength(0);
  });

  it('the next save of a config stored with the health check, per-sport overrides and a sports list stores it without them', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put(INGESTION_SCHEDULE_SETTINGS.key, {
      scheduledSports: ['GOLF'],
      healthCheck: { enabled: true, intervalMinutes: 5 },
      FIELD: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
      SCORES: { enabled: true, intervalSeconds: 45 },
      perSportOverrides: { GOLF: { SCORES: { intervalSeconds: 20 } } },
    });
    const { settings } = await loaded(repository);
    const service = new IngestionConfigService(settings, fakeLogger());

    await service.updateConfig({ EVENTS: { intervalMinutes: 10 } }, 'admin-1');

    const stored = repository.rows.get(INGESTION_SCHEDULE_SETTINGS.key)?.configJson;
    expect(stored).not.toHaveProperty('perSportOverrides');
    expect(stored).not.toHaveProperty('scheduledSports');
    expect(stored).not.toHaveProperty('healthCheck');
    expect(stored).toEqual(expect.objectContaining({ EVENTS: { enabled: true, intervalMinutes: 10 } }));
  });
});

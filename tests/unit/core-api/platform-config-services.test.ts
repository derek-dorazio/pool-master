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
import { PollConfigService, POLL_INTERVAL_SETTINGS } from '../../../packages/core-api/src/modules/platform/poll-config-service';
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
  env: Record<string, string> = { POOLMASTER_ENVIRONMENT: 'production' },
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

  it('refuses two groups declared with the same key', () => {
    expect(() => settingsFor(inMemoryRuntimeConfigs(), asGroups(sampleGroup(), sampleGroup())))
      .toThrow('Settings group SAMPLE_CONFIG is declared twice');
  });

  it('every registered group has defaults its own schema accepts', () => {
    for (const env of [{ POOLMASTER_ENVIRONMENT: 'qa' }, { POOLMASTER_ENVIRONMENT: 'production' }]) {
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

  it('updates and resets poll config, storing each change', async () => {
    const { repository, settings } = await loaded();
    const service = new PollConfigService(settings, fakeLogger());

    await expect(service.updateConfig({ draft: 15000 }, 'admin-1')).resolves.toEqual(
      expect.objectContaining({ draft: 15000, standings: 10000 }),
    );
    await expect(service.resetDefaults('admin-1')).resolves.toEqual(
      expect.objectContaining({ draft: 10000 }),
    );
    expect(repository.rows.get(POLL_INTERVAL_SETTINGS.key)?.configJson).toEqual(expect.objectContaining({ draft: 10000 }));
    expect(repository.history).toHaveLength(2);
  });

  it('ingestion config defaults the scheduled field sync to off, keeps live scores on, and has no schedule or results feed', async () => {
    const { settings } = await loaded();
    const service = new IngestionConfigService(settings, fakeLogger());

    const config = await service.getConfig();

    expect(config.eventParticipants.enabled).toBe(false);
    expect(config.eventLiveScores.enabled).toBe(true);
    expect(Object.keys(config).sort()).toEqual([
      'eventLiveScores',
      'eventParticipants',
      'healthCheck',
      'perSportOverrides',
      'scheduledSports',
    ]);
    await expect(service.resetDefaults('admin-1')).resolves.toEqual(expect.objectContaining({
      eventParticipants: expect.objectContaining({ enabled: false }),
    }));
  });

  it('updates ingestion config, resolves per-sport overrides, and resets defaults', async () => {
    const { settings } = await loaded();
    const service = new IngestionConfigService(settings, fakeLogger());

    await expect(
      service.updateConfig({
        scheduledSports: ['GOLF', 'TENNIS'],
        eventLiveScores: { intervalSeconds: 45 },
      }, 'admin-1'),
    ).resolves.toEqual(expect.objectContaining({
      scheduledSports: ['GOLF', 'TENNIS'],
      eventLiveScores: expect.objectContaining({ intervalSeconds: 45 }),
    }));
    await expect(
      service.setPerSportOverride('GOLF', { eventParticipants: { intervalMinutes: 720 } }, 'admin-1'),
    ).resolves.toEqual(expect.objectContaining({
      perSportOverrides: expect.objectContaining({
        GOLF: expect.objectContaining({
          eventParticipants: expect.objectContaining({ intervalMinutes: 720 }),
        }),
      }),
    }));
    await expect(service.getPerSportConfig('GOLF')).resolves.toEqual(
      expect.objectContaining({
        eventParticipants: expect.objectContaining({ intervalMinutes: 720 }),
      }),
    );
    await expect(service.clearPerSportOverride('GOLF', 'admin-1')).resolves.toEqual(
      expect.objectContaining({ perSportOverrides: {} }),
    );
    await expect(service.resetDefaults('admin-1')).resolves.toEqual(
      expect.objectContaining({
        scheduledSports: ['GOLF'],
        eventLiveScores: expect.objectContaining({ intervalSeconds: 300 }),
      }),
    );
  });

  it('a partial update on a task that has not yet refreshed keeps another task\'s save from moments earlier', async () => {
    const repository = inMemoryRuntimeConfigs();
    const taskA = await loaded(repository);
    const taskB = await loaded(repository);
    const ingestionOnA = new IngestionConfigService(taskA.settings, fakeLogger());
    const ingestionOnB = new IngestionConfigService(taskB.settings, fakeLogger());
    const pollOnA = new PollConfigService(taskA.settings, fakeLogger());
    const pollOnB = new PollConfigService(taskB.settings, fakeLogger());

    await ingestionOnA.setPerSportOverride('GOLF', { eventLiveScores: { intervalSeconds: 20 } }, 'admin-1');
    await ingestionOnB.updateConfig({ eventLiveScores: { intervalSeconds: 45 } }, 'admin-2');
    await pollOnA.updateConfig({ draft: 12000 }, 'admin-1');
    await pollOnB.updateConfig({ standings: 15000 }, 'admin-2');

    expect(repository.rows.get(INGESTION_SCHEDULE_SETTINGS.key)?.configJson).toEqual(expect.objectContaining({
      eventLiveScores: { enabled: true, intervalSeconds: 45 },
      perSportOverrides: { GOLF: { eventLiveScores: { intervalSeconds: 20 } } },
    }));
    expect(repository.rows.get(POLL_INTERVAL_SETTINGS.key)?.configJson).toEqual(expect.objectContaining({
      draft: 12000,
      standings: 15000,
    }));
  });

  it('a stored ingestion config loads with its live settings intact and is not rewritten on boot', async () => {
    const repository = inMemoryRuntimeConfigs();
    repository.put(INGESTION_SCHEDULE_SETTINGS.key, {
      scheduledSports: ['GOLF'],
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventParticipants: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
      eventLiveScores: { enabled: true, intervalSeconds: 45 },
      perSportOverrides: { GOLF: { eventLiveScores: { intervalSeconds: 20 } } },
    });
    const { settings } = await loaded(repository);
    const service = new IngestionConfigService(settings, fakeLogger());

    await expect(service.getPerSportConfig('GOLF')).resolves.toEqual(
      expect.objectContaining({ eventLiveScores: { enabled: true, intervalSeconds: 20 } }),
    );
    expect(repository.history).toHaveLength(0);
  });
});

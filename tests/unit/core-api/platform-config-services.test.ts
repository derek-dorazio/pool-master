import { expect } from '@jest/globals';
import { IngestionConfigService } from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { PollConfigService } from '../../../packages/core-api/src/modules/platform/poll-config-service';
import { fakeLogger } from '../../support/fake-logger';
import type { PlatformRuntimeConfigRepository } from '@poolmaster/shared/db';
import type { PlatformRuntimeConfig } from '@poolmaster/shared/domain';
import { IngestionScheduleConfigSchema } from '@poolmaster/shared/dto/config.dto';

/** An in-memory runtime-config store holding one persisted document. */
function storedConfigRepository(configJson: unknown): PlatformRuntimeConfigRepository & {
  writes: unknown[];
} {
  const writes: unknown[] = [];
  const row = (json: unknown): PlatformRuntimeConfig => ({
    id: 'runtime-config-1',
    configKey: 'INGESTION_SCHEDULE_CONFIG',
    configJson: json,
    updatedById: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
  return {
    writes,
    findByKey: async () => row(configJson),
    create: async (input) => row(input.configJson),
    update: async (input) => {
      writes.push(JSON.parse(JSON.stringify(input.configJson)));
      return row(input.configJson);
    },
  };
}

const RETIRED_FEED_POLICY_KEYS = ['participantRankings', 'eventSchedule', 'eventResults'] as const;

/**
 * The shape every environment persisted before #125 retired the PARTICIPANTRANKINGS feed and
 * #126 retired the EVENTSCHEDULE and EVENTRESULTS feeds.
 */
function configPersistedBeforeFeedsRetired() {
  return {
    scheduledSports: ['GOLF'],
    healthCheck: { enabled: true, intervalMinutes: 5 },
    eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
    eventParticipants: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
    participantRankings: { enabled: true, intervalMinutes: 1440 },
    eventLiveScores: { enabled: true, intervalSeconds: 45 },
    eventResults: { enabled: false, intervalMinutes: 30 },
    perSportOverrides: {
      GOLF: {
        participantRankings: { enabled: false },
        eventSchedule: { lookaheadDays: 90 },
        eventResults: { enabled: true },
        eventLiveScores: { intervalSeconds: 20 },
      },
      TENNIS: {
        participantRankings: { intervalMinutes: 60 },
      },
      NFL: {
        eventSchedule: { enabled: false },
        eventResults: { intervalMinutes: 10 },
      },
    },
  };
}

describe('platform config services', () => {
    it('updates and resets poll config', async () => {
      const service = new PollConfigService(fakeLogger());

      await expect(service.updateConfig({ draft: 15000 }, 'admin-1')).resolves.toEqual(
        expect.objectContaining({ draft: 15000 }),
      );
      await expect(service.resetDefaults('admin-1')).resolves.toEqual(
        expect.objectContaining({ draft: 10000 }),
      );
    });

    it('ingestion config defaults the scheduled field sync to off, keeps live scores on, and has no schedule or results feed', async () => {
      const service = new IngestionConfigService(fakeLogger());

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
      const service = new IngestionConfigService(fakeLogger());

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
      await expect(service.resetDefaults('admin-1')).resolves.toEqual(
        expect.objectContaining({
          scheduledSports: ['GOLF'],
          eventLiveScores: expect.objectContaining({ intervalSeconds: 300 }),
        }),
      );
    });

    describe('a persisted ingestion config that still carries the retired participantRankings (#125), eventSchedule and eventResults (#126) policies', () => {
      it('loads with the admin\'s live-score and participant settings intact instead of reverting to defaults', async () => {
        const repository = storedConfigRepository(configPersistedBeforeFeedsRetired());
        const service = new IngestionConfigService(repository, fakeLogger());

        const config = await service.getConfig();

        expect(config.eventLiveScores).toEqual({ enabled: true, intervalSeconds: 45 });
        expect(config.eventParticipants).toEqual({ enabled: true, intervalMinutes: 720, lookaheadDays: 21 });
        expect(config.perSportOverrides.GOLF).toEqual({ eventLiveScores: { intervalSeconds: 20 } });
        await expect(service.getPerSportConfig('GOLF')).resolves.toEqual(
          expect.objectContaining({ eventLiveScores: { enabled: true, intervalSeconds: 20 } }),
        );
      });

      it('drops every retired key everywhere, and drops a per-sport override that held nothing else', async () => {
        const repository = storedConfigRepository(configPersistedBeforeFeedsRetired());
        const service = new IngestionConfigService(repository, fakeLogger());

        const config = await service.getConfig();

        for (const key of RETIRED_FEED_POLICY_KEYS) {
          expect(config).not.toHaveProperty(key);
          expect(config.perSportOverrides.GOLF).not.toHaveProperty(key);
        }
        expect(config.perSportOverrides).not.toHaveProperty('TENNIS');
        expect(config.perSportOverrides).not.toHaveProperty('NFL');
        expect(IngestionScheduleConfigSchema.strict().safeParse(config).success).toBe(true);
      });

      it('rewrites the stored document without the retired keys, keeping every live setting', async () => {
        const repository = storedConfigRepository(configPersistedBeforeFeedsRetired());
        const service = new IngestionConfigService(repository, fakeLogger());

        await service.bootstrap();

        expect(repository.writes).toHaveLength(1);
        for (const key of RETIRED_FEED_POLICY_KEYS) {
          expect(repository.writes[0]).not.toHaveProperty(key);
        }
        expect(repository.writes[0]).toEqual(expect.objectContaining({
          eventParticipants: { enabled: true, intervalMinutes: 720, lookaheadDays: 21 },
          eventLiveScores: { enabled: true, intervalSeconds: 45 },
          perSportOverrides: { GOLF: { eventLiveScores: { intervalSeconds: 20 } } },
        }));
      });
    });

    it('a persisted ingestion config with no retired key loads as stored and is not rewritten', async () => {
      const current: Record<string, unknown> = { ...configPersistedBeforeFeedsRetired(), perSportOverrides: {} };
      for (const key of RETIRED_FEED_POLICY_KEYS) {
        delete current[key];
      }
      const repository = storedConfigRepository(current);
      const service = new IngestionConfigService(repository, fakeLogger());

      await expect(service.getConfig()).resolves.toEqual(expect.objectContaining({
        eventLiveScores: { enabled: true, intervalSeconds: 45 },
      }));
      expect(repository.writes).toHaveLength(0);
    });
});

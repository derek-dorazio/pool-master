import { expect } from '@jest/globals';
import { IngestionConfigService } from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { PollConfigService } from '../../../packages/core-api/src/modules/platform/poll-config-service';
import { fakeLogger } from '../../support/fake-logger';

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
        service.setPerSportOverride('GOLF', { participantRankings: { intervalMinutes: 360 } }, 'admin-1'),
      ).resolves.toEqual(expect.objectContaining({
        perSportOverrides: expect.objectContaining({
          GOLF: expect.objectContaining({
            participantRankings: expect.objectContaining({ intervalMinutes: 360 }),
          }),
        }),
      }));
      await expect(service.getPerSportConfig('GOLF')).resolves.toEqual(
        expect.objectContaining({
          participantRankings: expect.objectContaining({ intervalMinutes: 360 }),
        }),
      );
      await expect(service.resetDefaults('admin-1')).resolves.toEqual(
        expect.objectContaining({
          scheduledSports: ['GOLF'],
          eventLiveScores: expect.objectContaining({ intervalSeconds: 300 }),
        }),
      );
    });
});

/**
 * Unit tests for the typed live-score bus boundary
 * (`publishLiveScoreUpdate`) per pool-master-rop.78.3 / plans/117 §10.3.
 *
 * Coverage:
 *   - Zod validation rejects malformed `LiveScoreResult` payloads at the
 *     boundary (no DB writes, no bus emission).
 *   - GOLF persistence resolves `participantExternalId` to internal
 *     `SportEventParticipant.id` via ParticipantProviderMapping +
 *     SportEventParticipant lookup, upserts golf-round rows, and emits
 *     a typed `live_score.persisted` event.
 *   - Unmapped external ids are skipped (warned, not thrown).
 *   - Non-GOLF categories throw `LiveScorePersistenceUnsupportedError`
 *     until their per-category persistence slice ships.
 */

import {
  publishLiveScoreUpdate,
  LiveScoreValidationError,
  LiveScorePersistenceUnsupportedError,
} from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

function buildBus() {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    clear: jest.fn(),
  } as any;
}

describe('pool-master-rop.78.3 / plans/117 §10.3 — publishLiveScoreUpdate', () => {
  describe('Zod validation at the bus boundary', () => {
    it('rejects a malformed LiveScoreResult before any persistence', async () => {
      const prisma = {
        participantProviderMapping: { findMany: jest.fn() },
        sportEventParticipant: { findMany: jest.fn() },
        sportEventParticipantGolfRound: { upsert: jest.fn() },
      } as any;
      const bus = buildBus();

      const malformed = {
        category: 'GOLF',
        rounds: [{ participantExternalId: '', round: 0, strokes: -1, scoreToPar: 0, status: 'BOGUS' }],
      };

      await expect(
        publishLiveScoreUpdate(malformed as any, { prisma, providerId: 'mock', bus }),
      ).rejects.toBeInstanceOf(LiveScoreValidationError);
      expect(prisma.sportEventParticipantGolfRound.upsert).not.toHaveBeenCalled();
      expect(bus.publish).not.toHaveBeenCalled();
    });
  });

  describe('GOLF category', () => {
    it('upserts SportEventParticipantGolfRound rows and emits live_score.persisted', async () => {
      const prisma = {
        participantProviderMapping: {
          findMany: jest.fn().mockResolvedValue([
            { externalId: 'rory', participantId: 'pp-rory' },
            { externalId: 'tiger', participantId: 'pp-tiger' },
          ]),
        },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sep-rory', participantId: 'pp-rory', sportEventId: 'evt-1', createdAt: new Date('2026-04-01') },
            { id: 'sep-tiger', participantId: 'pp-tiger', sportEventId: 'evt-1', createdAt: new Date('2026-04-01') },
          ]),
        },
        sportEventParticipantGolfRound: {
          upsert: jest.fn().mockResolvedValue({}),
        },
      } as any;
      const bus = buildBus();

      const result: LiveScoreResult = {
        category: 'GOLF',
        rounds: [
          { participantExternalId: 'rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
          { participantExternalId: 'tiger', round: 1, strokes: 73, scoreToPar: 1, status: 'IN_PROGRESS' },
        ],
      };

      const persisted = await publishLiveScoreUpdate(result, {
        prisma,
        providerId: 'mock-contest-feed',
        bus,
      });

      expect(persisted).toBe(2);
      expect(prisma.sportEventParticipantGolfRound.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.sportEventParticipantGolfRound.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sportEventParticipantId_round: { sportEventParticipantId: 'sep-rory', round: 1 } },
          create: expect.objectContaining({ strokes: 70, scoreToPar: -2, status: 'COMPLETED' }),
        }),
      );
      expect(bus.publish).toHaveBeenCalledWith(
        'live_score.persisted',
        expect.objectContaining({
          type: 'live_score.persisted',
          category: 'GOLF',
          providerId: 'mock-contest-feed',
          updatesPersisted: 2,
        }),
      );
    });

    it('skips unmapped external ids without throwing and persists only the mapped rows', async () => {
      const prisma = {
        participantProviderMapping: {
          findMany: jest.fn().mockResolvedValue([
            { externalId: 'rory', participantId: 'pp-rory' },
            // 'unknown-golfer' is intentionally absent.
          ]),
        },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sep-rory', participantId: 'pp-rory', sportEventId: 'evt-1', createdAt: new Date() },
          ]),
        },
        sportEventParticipantGolfRound: {
          upsert: jest.fn().mockResolvedValue({}),
        },
      } as any;
      const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as any;
      const bus = buildBus();

      const result: LiveScoreResult = {
        category: 'GOLF',
        rounds: [
          { participantExternalId: 'rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
          { participantExternalId: 'unknown-golfer', round: 1, strokes: 80, scoreToPar: 8, status: 'COMPLETED' },
        ],
      };

      const persisted = await publishLiveScoreUpdate(result, {
        prisma,
        providerId: 'mock-contest-feed',
        bus,
        logger,
      });

      expect(persisted).toBe(1);
      expect(prisma.sportEventParticipantGolfRound.upsert).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'liveScore.golf.unmappedExternalId' }),
        expect.any(String),
      );
    });
  });

  describe('non-GOLF categories', () => {
    it('throws LiveScorePersistenceUnsupportedError for BASKETBALL until the slice ships', async () => {
      const prisma = {
        participantProviderMapping: { findMany: jest.fn() },
        sportEventParticipant: { findMany: jest.fn() },
        sportEventParticipantGolfRound: { upsert: jest.fn() },
      } as any;
      const bus = buildBus();

      const result: LiveScoreResult = {
        category: 'BASKETBALL',
        games: [],
      };

      await expect(
        publishLiveScoreUpdate(result, { prisma, providerId: 'mock', bus }),
      ).rejects.toBeInstanceOf(LiveScorePersistenceUnsupportedError);
      expect(bus.publish).not.toHaveBeenCalled();
    });
  });
});

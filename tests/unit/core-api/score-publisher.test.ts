/**
 * Unit tests for the typed live-score entry point
 * (`publishLiveScoreUpdate`) per pool-master-rop.78.3 / plans/117 §10.3.
 *
 * Coverage:
 *   - Zod validation rejects malformed `LiveScoreResult` payloads before any
 *     DB write.
 *   - Rounds with null strokes are skipped before any write.
 *   - What GOLF persistence writes — rounds and standings scoped to the named
 *     event, non-finisher statuses, idempotent-poll diagnostics, skipped
 *     unmapped ids — is asserted against
 *     Postgres in tests/integration/core-api/golf-participant-standing.integration.ts.
 *   - Unknown externalEventId logs a warn and skips persistence.
 *   - Non-GOLF categories throw `LiveScorePersistenceUnsupportedError`
 *     until their per-category persistence slice ships.
 */

import {
  publishLiveScoreUpdate,
  LiveScoreValidationError,
  LiveScorePersistenceUnsupportedError,
} from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { fakeLogger } from '../../support/fake-logger';
import { asPrismaClient } from '../../support/prisma-double';

function buildSportEventStub(internalId = 'evt-1') {
  return {
    findUnique: jest.fn().mockResolvedValue({ id: internalId }),
  };
}

describe('pool-master-rop.78.3 / plans/117 §10.3 — publishLiveScoreUpdate', () => {
  describe('Zod validation', () => {
    it('rejects a malformed LiveScoreResult before any persistence', async () => {
      const prisma = {
        sportEvent: buildSportEventStub(),
        participantProviderMapping: { findMany: jest.fn() },
        sportEventParticipant: { findMany: jest.fn() },
        sportEventParticipantRound: { upsert: jest.fn(), findMany: jest.fn() },
        sportEventParticipantStanding: { upsert: jest.fn(), findMany: jest.fn() },
      };

      // Type-correct, schema-invalid: an empty id, round 0 and negative strokes are what the
      // type cannot express and the runtime schema exists to reject.
      const malformed: LiveScoreResult = {
        category: 'GOLF',
        externalEventId: 'evt-ext-1',
        rounds: [{ participantExternalId: '', round: 0, strokes: -1, scoreToPar: 0, status: 'COMPLETED' }],
      };

      await expect(
        publishLiveScoreUpdate(malformed, { prisma: asPrismaClient(prisma), providerId: 'mock' }),
      ).rejects.toBeInstanceOf(LiveScoreValidationError);
      expect(prisma.sportEventParticipantRound.upsert).not.toHaveBeenCalled();
    });
  });

  describe('GOLF category', () => {
    it('skips rounds with null strokes (mock + ESPN providers) so synthetic data is never persisted', async () => {
      const prisma = {
        sportEvent: buildSportEventStub(),
        sportEventRound: {
          findMany: jest.fn().mockResolvedValue([{ id: 'ser-1', roundNumber: 1 }]),
        },
        participantProviderMapping: {
          findMany: jest.fn().mockResolvedValue([
            { externalId: 'rory', participantId: 'pp-rory' },
          ]),
        },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sep-rory', participantId: 'pp-rory' },
          ]),
        },
        sportEventParticipantRound: {
          upsert: jest.fn().mockResolvedValue({}),
          findMany: jest.fn(),
        },
        sportEventParticipantStanding: { upsert: jest.fn(), findMany: jest.fn() },
      };

      const result: LiveScoreResult = {
        category: 'GOLF',
        externalEventId: 'evt-ext-1',
        rounds: [
          { participantExternalId: 'rory', round: 1, strokes: null, scoreToPar: -2, status: 'IN_PROGRESS' },
        ],
      };

      const persisted = await publishLiveScoreUpdate(result, {
        prisma: asPrismaClient(prisma),
        providerId: 'mock-contest-feed',
      });

      expect(persisted).toMatchObject({
        updatesReturned: 1,
        updatesPersisted: 0,
        updatesSkipped: 1,
        writeDiagnostics: {
          summary: {
            total: 0,
            unchanged: 0,
            created: 0,
            updated: 0,
            deleted: 0,
          },
        },
      });
      expect(prisma.sportEventParticipantRound.upsert).not.toHaveBeenCalled();
    });

    it('warns and skips persistence when externalEventId resolves to no SportEvent', async () => {
      const prisma = {
        sportEvent: { findUnique: jest.fn().mockResolvedValue(null) },
        participantProviderMapping: { findMany: jest.fn() },
        sportEventParticipant: { findMany: jest.fn() },
        sportEventParticipantRound: { upsert: jest.fn(), findMany: jest.fn() },
        sportEventParticipantStanding: { upsert: jest.fn(), findMany: jest.fn() },
      };
      const logger = fakeLogger();

      const result: LiveScoreResult = {
        category: 'GOLF',
        externalEventId: 'evt-ext-unknown',
        rounds: [
          { participantExternalId: 'rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
        ],
      };

      const persisted = await publishLiveScoreUpdate(result, {
        prisma: asPrismaClient(prisma),
        providerId: 'mock-contest-feed',
        logger,
      });

      expect(persisted).toMatchObject({
        updatesReturned: 1,
        updatesPersisted: 0,
        updatesSkipped: 1,
      });
      expect(prisma.sportEventParticipantRound.upsert).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'liveScore.publish.unknownSportEvent' }),
        expect.any(String),
      );
    });
  });

  describe('non-GOLF categories', () => {
    it('throws LiveScorePersistenceUnsupportedError for BASKETBALL until the slice ships', async () => {
      const prisma = {
        sportEvent: buildSportEventStub(),
        participantProviderMapping: { findMany: jest.fn() },
        sportEventParticipant: { findMany: jest.fn() },
        sportEventParticipantRound: { upsert: jest.fn(), findMany: jest.fn() },
        sportEventParticipantStanding: { upsert: jest.fn(), findMany: jest.fn() },
      };

      const result: LiveScoreResult = {
        category: 'BASKETBALL',
        externalEventId: 'evt-ext-1',
        games: [],
      };

      await expect(
        publishLiveScoreUpdate(result, { prisma: asPrismaClient(prisma), providerId: 'mock' }),
      ).rejects.toBeInstanceOf(LiveScorePersistenceUnsupportedError);
    });
  });
});

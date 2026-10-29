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
 */

import {
  publishLiveScoreUpdate,
  LiveScoreValidationError,
} from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { expect } from '@jest/globals';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { scoringFamilyForEvent, type ScoringFamilyModule } from '../../../packages/core-api/src/modules/scoring-families';
import { strokePlayScoringFamily } from '../../../packages/core-api/src/modules/scoring-families/stroke-play';
import { fakeLogger } from '../../support/fake-logger';
import { asPrismaClient } from '../../support/prisma-double';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import type { SportEventParticipantView } from '@poolmaster/shared/db';

function buildSportEventStub(internalId = 'evt-1') {
  return {
    findUnique: jest.fn().mockResolvedValue({ id: internalId, sport: 'GOLF', status: 'IN_PROGRESS', eventSeries: { sportLeague: { scoringFamily: null } } }),
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
        publishLiveScoreUpdate(malformed, { prisma: asPrismaClient(prisma), providerId: 'mock', scoringFamilyForEvent }),
      ).rejects.toBeInstanceOf(LiveScoreValidationError);
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
        scoringFamilyForEvent,
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
        scoringFamilyForEvent,
      });

      expect(persisted).toMatchObject({
        updatesReturned: 1,
        updatesPersisted: 0,
        updatesSkipped: 1,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'liveScore.publish.unknownSportEvent' }),
        expect.any(String),
      );
    });
  });

  describe('event status', () => {
    it.each(['DRAFT', 'SCHEDULED', 'POSTPONED', 'COMPLETED', 'CANCELLED'])(
      'writes no score to a %s event, since live scores are accepted only while an event is in progress',
      async (status) => {
        const prisma = {
          sportEvent: { findUnique: jest.fn().mockResolvedValue({ id: 'evt-1', rounds: 4, status }) },
          sportEventRound: { findMany: jest.fn().mockResolvedValue([{ id: 'ser-1', roundNumber: 1 }]) },
          participantProviderMapping: { findMany: jest.fn().mockResolvedValue([{ externalId: 'rory', participantId: 'pp-rory' }]) },
          sportEventParticipant: { findMany: jest.fn().mockResolvedValue([{ id: 'sep-rory', participantId: 'pp-rory' }]) },
          sportEventParticipantRound: { upsert: jest.fn(), findMany: jest.fn() },
          sportEventParticipantStanding: { upsert: jest.fn(), findMany: jest.fn() },
        };
        const logger = fakeLogger();
        const result: LiveScoreResult = {
          category: 'GOLF',
          externalEventId: 'evt-ext-1',
          rounds: [{ participantExternalId: 'rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' }],
        };

        const persisted = await publishLiveScoreUpdate(result, { prisma: asPrismaClient(prisma), providerId: 'mock', logger, scoringFamilyForEvent });

        expect(persisted).toMatchObject({ updatesReturned: 1, updatesPersisted: 0, updatesSkipped: 1 });
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'liveScore.publish.eventNotInProgress' }),
          expect.any(String),
        );
      },
    );
  });

  describe('the event\'s scoring family', () => {
    // Golf is the only sport, and stroke play accepts GOLF, so a family that accepts no live
    // scores (one whose results an admin enters) is injected as the event's family.
    const adminEnteredFamily: ScoringFamilyModule = { ...strokePlayScoringFamily, liveScores: null };

    it('warns and writes nothing when the event\'s scoring family accepts no live-score category', async () => {
      const prisma = {
        sportEvent: { findUnique: jest.fn().mockResolvedValue({ id: 'evt-1', sport: 'GOLF', rounds: 4, status: 'IN_PROGRESS', eventSeries: { sportLeague: { scoringFamily: null } } }) },
        sportEventRound: { findMany: jest.fn() },
        participantProviderMapping: { findMany: jest.fn() },
        sportEventParticipant: { findMany: jest.fn() },
        sportEventParticipantRound: { upsert: jest.fn(), findMany: jest.fn() },
        sportEventParticipantStanding: { upsert: jest.fn(), findMany: jest.fn() },
      };
      const logger = fakeLogger();
      const result: LiveScoreResult = {
        category: 'GOLF',
        externalEventId: 'evt-ext-1',
        rounds: [{ participantExternalId: 'rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' }],
      };

      const persisted = await publishLiveScoreUpdate(result, {
        prisma: asPrismaClient(prisma),
        providerId: 'mock',
        logger,
        scoringFamilyForEvent: () => adminEnteredFamily,
      });

      expect(persisted).toMatchObject({ updatesReturned: 1, updatesPersisted: 0, updatesSkipped: 1 });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'liveScore.publish.categoryNotAccepted',
          data: expect.objectContaining({ category: 'GOLF', acceptedCategory: null }),
        }),
        expect.any(String),
      );
      expect(prisma.sportEventParticipantRound.upsert).not.toHaveBeenCalled();
    });
  });

  describe('the event\'s field this container read lately (#1163)', () => {
    const NOW = new Date('2026-10-28T20:00:00.000Z');
    const result: LiveScoreResult = {
      category: 'GOLF',
      externalEventId: 'evt-ext-1',
      rounds: [{ participantExternalId: 'rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' }],
    };
    const persisted = { updatesReturned: 1, updatesPersisted: 1, updatesSkipped: 0, writeDiagnostics: { summary: { total: 0, unchanged: 0, created: 0, updated: 0, deleted: 0 }, rows: [] } };

    /** A cache already holding event evt-1's field, as read by a viewer moments ago. */
    async function cacheHoldingTheField() {
      const fieldCache = new ReadCache<SportEventParticipantView[]>();
      await fieldCache.get('evt-1', NOW, async () => []);
      return fieldCache;
    }

    /** Whether the cache reads evt-1's field afresh, rather than answering with the one it holds. */
    async function readsAfresh(fieldCache: ReadCache<SportEventParticipantView[]>): Promise<boolean> {
      let read = false;
      await fieldCache.get('evt-1', NOW, async () => { read = true; return []; });
      return read;
    }

    function familyWriting(persist: () => Promise<typeof persisted>): ScoringFamilyModule {
      return { ...strokePlayScoringFamily, liveScores: { category: 'GOLF', persist } };
    }

    it('forgets the event\'s field once its live scores are written, so the next read of it is current', async () => {
      const fieldCache = await cacheHoldingTheField();

      await publishLiveScoreUpdate(result, {
        prisma: asPrismaClient({ sportEvent: buildSportEventStub() }),
        providerId: 'mock',
        scoringFamilyForEvent: () => familyWriting(async () => persisted),
        fieldCache,
      });

      expect(await readsAfresh(fieldCache)).toBe(true);
    });

    it('forgets it too when writing the scores fails partway, since some may have been written', async () => {
      const fieldCache = await cacheHoldingTheField();

      await expect(publishLiveScoreUpdate(result, {
        prisma: asPrismaClient({ sportEvent: buildSportEventStub() }),
        providerId: 'mock',
        scoringFamilyForEvent: () => familyWriting(async () => { throw new Error('connection reset'); }),
        fieldCache,
      })).rejects.toThrow('connection reset');

      expect(await readsAfresh(fieldCache)).toBe(true);
    });

    it('keeps it when the scores are refused unwritten, since the field has not changed', async () => {
      const fieldCache = await cacheHoldingTheField();
      const prisma = { sportEvent: { findUnique: jest.fn().mockResolvedValue({ id: 'evt-1', sport: 'GOLF', status: 'COMPLETED', eventSeries: { sportLeague: { scoringFamily: null } } }) } };

      await publishLiveScoreUpdate(result, { prisma: asPrismaClient(prisma), providerId: 'mock', logger: fakeLogger(), scoringFamilyForEvent, fieldCache });

      expect(await readsAfresh(fieldCache)).toBe(false);
    });
  });
});

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

import { NO_CONTEST_ACTIVATION, testDomainEvents } from '../../support/domain-events';
import { RecordingDomainEvents } from '../../support/recording-domain-events';
import { mockFn } from '../../support/mock-fn';
import {
  publishLiveScoreUpdate,
  LiveScoreValidationError,
  type LiveScorePublisherDeps,
} from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { expect } from '@jest/globals';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { scoringFamilyForEvent, type ScoringFamilyModule } from '../../../packages/core-api/src/modules/scoring-families';
import { strokePlayScoringFamily } from '../../../packages/core-api/src/modules/scoring-families/stroke-play';
import { fakeLogger } from '../../support/fake-logger';
import { asPrismaClient } from '../../support/prisma-double';
import { ReadCache } from '../../../packages/core-api/src/core/read-cache';
import type { SportEventParticipantView } from '@poolmaster/shared/db';

type UnmappedRaise = Parameters<LiveScorePublisherDeps['findings']['raiseUnmappedParticipants']>[0];

/** The findings the publisher raises, recorded; it raises nothing elsewhere. */
function recordingFindings() {
  const raised: UnmappedRaise[] = [];
  return { raised, raiseUnmappedParticipants: async (input: UnmappedRaise) => { raised.push(input); } };
}

const NO_FINDINGS = recordingFindings();

/** The provider's event mapping the publisher reads, naming `row` as its event, or none. */
function atProvider<T>(row: T | null) {
  return row === null ? null : { sportEvent: row };
}

function buildSportEventStub(internalId = 'evt-1') {
  return {
    findFirst: jest.fn().mockResolvedValue(atProvider({ id: internalId, sport: 'GOLF', status: 'IN_PROGRESS', sportLeagueSeason: { sportLeague: { id: 'league-1', scoringFamily: 'STROKE_PLAY' } } })),
  };
}

describe('pool-master-rop.78.3 / plans/117 §10.3 — publishLiveScoreUpdate', () => {
  describe('Zod validation', () => {
    it('rejects a malformed LiveScoreResult before any persistence', async () => {
      const prisma = {
        sportEventProviderMapping: buildSportEventStub(),
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
        publishLiveScoreUpdate(malformed, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS, prisma: asPrismaClient(prisma), domainEvents: testDomainEvents(), providerId: 'balldontlie', scoringFamilyForEvent }),
      ).rejects.toBeInstanceOf(LiveScoreValidationError);
    });
  });

  describe('GOLF category', () => {
    it('skips rounds with null strokes (mock + ESPN providers) so synthetic data is never persisted', async () => {
      const prisma = {
        sportEventProviderMapping: buildSportEventStub(),
        sportEventRound: {
          findMany: jest.fn().mockResolvedValue([{ id: 'ser-1', roundNumber: 1 }]),
        },
        participantProviderMapping: {
          findMany: jest.fn().mockResolvedValue([
            { externalId: 'rory', participantId: 'pp-rory', provider: { name: 'BALLDONTLIE' } },
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

      const persisted = await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient(prisma),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
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
        sportEventProviderMapping: { findFirst: jest.fn().mockResolvedValue(atProvider(null)) },
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

      const persisted = await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient(prisma),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
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
          sportEventProviderMapping: { findFirst: jest.fn().mockResolvedValue(atProvider({ id: 'evt-1', rounds: 4, status })) },
          sportEventRound: { findMany: jest.fn().mockResolvedValue([{ id: 'ser-1', roundNumber: 1 }]) },
          participantProviderMapping: { findMany: jest.fn().mockResolvedValue([{ externalId: 'rory', participantId: 'pp-rory', provider: { name: 'BALLDONTLIE' } }]) },
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

        const persisted = await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS, prisma: asPrismaClient(prisma), domainEvents: testDomainEvents(), providerId: 'balldontlie', logger, scoringFamilyForEvent });

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
        sportEventProviderMapping: { findFirst: jest.fn().mockResolvedValue(atProvider({ id: 'evt-1', sport: 'GOLF', rounds: 4, status: 'IN_PROGRESS', sportLeagueSeason: { sportLeague: { id: 'league-1', scoringFamily: 'STROKE_PLAY' } } })) },
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

      const persisted = await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient(prisma),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
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

  describe('game scores (#1496)', () => {
    const games: LiveScoreResult = {
      category: 'GAME',
      externalEventId: 'nfl-2025-postseason',
      games: [{ externalGameId: 'g1', homeTeamExternalId: '1', awayTeamExternalId: '2', state: 'FINAL', homeScore: 27, awayScore: 24 }],
    };
    const persisted = { updatesReturned: 1, updatesPersisted: 1, updatesSkipped: 0, writeDiagnostics: { summary: { total: 0, unchanged: 0, created: 0, updated: 0, deleted: 0 }, rows: [] } };
    const inProgressEvent = () => ({ findFirst: jest.fn().mockResolvedValue(atProvider({ id: 'evt-1', sport: 'NFL', rounds: null, status: 'IN_PROGRESS', sportLeagueSeason: { sportLeague: { id: 'league-1', scoringFamily: 'HEAD_TO_HEAD' } } })) });

    it('hands a GAME batch to the event\'s family writer when it takes game scores, with the event it resolved', async () => {
      const persist = jest.fn().mockResolvedValue(persisted);

      const result = await publishLiveScoreUpdate(games, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient({ sportEventProviderMapping: inProgressEvent() }),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
        scoringFamilyForEvent: () => ({ ...strokePlayScoringFamily, liveScores: { category: 'GAME', persist } }),
      });

      expect(result).toBe(persisted);
      expect(persist).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'balldontlie' }), expect.objectContaining({ id: 'evt-1' }), games);
    });

    it('warns and writes nothing when the event\'s family takes golf scores, not game scores', async () => {
      const persist = jest.fn();
      const logger = fakeLogger();

      const result = await publishLiveScoreUpdate(games, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient({ sportEventProviderMapping: inProgressEvent() }),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
        logger,
        scoringFamilyForEvent: () => ({ ...strokePlayScoringFamily, liveScores: { category: 'GOLF', persist } }),
      });

      expect(persist).not.toHaveBeenCalled();
      expect(result).toMatchObject({ updatesReturned: 1, updatesPersisted: 0, updatesSkipped: 1 });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'liveScore.publish.categoryNotAccepted', data: expect.objectContaining({ category: 'GAME', acceptedCategory: 'GOLF' }) }),
        expect.any(String),
      );
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

      await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient({ sportEventProviderMapping: buildSportEventStub() }),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
        scoringFamilyForEvent: () => familyWriting(async () => persisted),
        fieldCache,
      });

      expect(await readsAfresh(fieldCache)).toBe(true);
    });

    it('raises an unmapped participant finding on the event\'s league for each feed id the writer could not match (#1999)', async () => {
      const findings = recordingFindings();

      await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings,
        prisma: asPrismaClient({ sportEventProviderMapping: buildSportEventStub() }),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
        scoringFamilyForEvent: () => familyWriting(async () => ({ ...persisted, unmappedExternalIds: ['golfer-9'] })),
      });

      expect(findings.raised).toEqual([{ sportLeagueId: 'league-1', providerSourceId: 'balldontlie', participants: [{ externalId: 'golfer-9', name: null }] }]);
    });

    it('still returns the written scores, and logs ingestion.syncFinding.raiseFailed, when raising the unmapped findings fails', async () => {
      const logger = fakeLogger();
      const findings = { raiseUnmappedParticipants: async () => { throw new Error('connection reset'); } };

      const written = await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings, logger,
        prisma: asPrismaClient({ sportEventProviderMapping: buildSportEventStub() }),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
        scoringFamilyForEvent: () => familyWriting(async () => ({ ...persisted, unmappedExternalIds: ['golfer-9'] })),
      });

      expect(written).toEqual({ ...persisted, unmappedExternalIds: ['golfer-9'] });
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.syncFinding.raiseFailed' }), expect.any(String));
    });

    it('forgets it too when writing the scores fails partway, since some may have been written', async () => {
      const fieldCache = await cacheHoldingTheField();

      await expect(publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient({ sportEventProviderMapping: buildSportEventStub() }),
        domainEvents: testDomainEvents(), providerId: 'balldontlie',
        scoringFamilyForEvent: () => familyWriting(async () => { throw new Error('connection reset'); }),
        fieldCache,
      })).rejects.toThrow('connection reset');

      expect(await readsAfresh(fieldCache)).toBe(true);
    });

    it('hands the scoring family\'s writer the app\'s domain event map, whose last write carries the event\'s rebuild, and asks for no rebuild itself (#1466, #1946)', async () => {
      const domainEvents = new RecordingDomainEvents();
      const persist = mockFn<NonNullable<ScoringFamilyModule['liveScores']>['persist']>(async () => persisted);

      await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS,
        prisma: asPrismaClient({ sportEventProviderMapping: buildSportEventStub() }),
        providerId: 'balldontlie',
        scoringFamilyForEvent: () => ({ ...strokePlayScoringFamily, liveScores: { category: 'GOLF', persist } }),
        domainEvents,
      });

      expect(persist).toHaveBeenCalledWith(expect.objectContaining({ domainEvents }), expect.anything(), expect.anything());
      expect(domainEvents.handedOutSportEventIds).toEqual([]);
    });

    it('asks for no rebuild when the scores are refused unwritten (#1435)', async () => {
      const domainEvents = new RecordingDomainEvents();
      const prisma = { sportEventProviderMapping: { findFirst: jest.fn().mockResolvedValue(atProvider({ id: 'evt-1', sport: 'GOLF', status: 'COMPLETED', sportLeagueSeason: { sportLeague: { id: 'league-1', scoringFamily: 'STROKE_PLAY' } } })) } };

      await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS, prisma: asPrismaClient(prisma), providerId: 'balldontlie', logger: fakeLogger(), scoringFamilyForEvent, domainEvents });

      expect(domainEvents.changedSportEventIds).toEqual([]);
    });

    it('keeps it when the scores are refused unwritten, since the field has not changed', async () => {
      const fieldCache = await cacheHoldingTheField();
      const prisma = { sportEventProviderMapping: { findFirst: jest.fn().mockResolvedValue(atProvider({ id: 'evt-1', sport: 'GOLF', status: 'COMPLETED', sportLeagueSeason: { sportLeague: { id: 'league-1', scoringFamily: 'STROKE_PLAY' } } })) } };

      await publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, findings: NO_FINDINGS, prisma: asPrismaClient(prisma), domainEvents: testDomainEvents(), providerId: 'balldontlie', logger: fakeLogger(), scoringFamilyForEvent, fieldCache });

      expect(await readsAfresh(fieldCache)).toBe(false);
    });
  });
});

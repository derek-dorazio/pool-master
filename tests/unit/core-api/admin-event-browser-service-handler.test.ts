import { randomUUID } from 'crypto';
import * as SharedDomainEnums from '@poolmaster/shared/domain/enums';
import { createEventBrowserAdminHandlers } from '../../../packages/core-api/src/modules/admin/event-browser-handler';
import { AdminEventBrowserService } from '../../../packages/core-api/src/modules/admin/event-browser-service';

describe('pool-master-33l.12: root-admin current-state event browser', () => {
  const eventId = randomUUID();
  const participantId = randomUUID();
  const sportEventParticipantId = randomUUID();

  function createEventRow() {
    return {
      id: eventId,
      externalId: 'golf-relative-weekend-20260507',
      providerId: 'mock-contest-feed',
      sport: 'GOLF',
      name: 'Rolling Weekend Invitational',
      venue: 'Mock Golf Club',
      location: 'Augusta, GA',
      status: 'SCHEDULED',
      startDate: new Date('2026-05-07T12:00:00.000Z'),
      endDate: new Date('2026-05-10T22:00:00.000Z'),
      releaseAt: new Date('2026-04-23T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-05-06T16:00:00.000Z'),
      fieldLocked: false,
      participantCount: 144,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
      updatedAt: new Date('2026-05-01T11:00:00.000Z'),
      _count: {
        sportEventParticipants: 72,
      },
    };
  }

  it('lists current persisted events with provider/source and readiness context', async () => {
    const findMany = jest.fn().mockResolvedValue([createEventRow()]);
    const service = new AdminEventBrowserService({
      sportEvent: { findMany },
    } as never);

    const events = await service.listEvents({ sport: 'GOLF', limit: 50 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sport: 'GOLF' },
        take: 50,
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        id: eventId,
        externalId: 'golf-relative-weekend-20260507',
        providerId: 'mock-contest-feed',
        loadedParticipantCount: 72,
        readinessStatus: expect.any(String),
      }),
    ]);
  });

  it('lists current persisted event participants with rankings, odds, valuations, and golf rounds', async () => {
    const findUnique = jest.fn().mockResolvedValue(createEventRow());
    const findMany = jest.fn().mockResolvedValue([
      {
        id: sportEventParticipantId,
        sportEventId: eventId,
        participantId,
        isActive: true,
        inactiveReason: null,
        worldRanking: 3,
        oddsToWin: { toNumber: () => 12.5 },
        seedNumber: null,
        updatedAt: new Date('2026-05-01T12:00:00.000Z'),
        participant: {
          name: 'Avery Driver',
          shortName: 'A. Driver',
          nationality: 'US',
        },
        golfRounds: [
          {
            strokes: 70,
            scoreToPar: -2,
            thru: 18,
            status: 'COMPLETE',
            completedAt: new Date('2026-05-07T21:00:00.000Z'),
            sportEventRound: { roundNumber: 1 },
          },
          {
            strokes: 71,
            scoreToPar: -1,
            thru: 9,
            status: 'COMPLETE',
            completedAt: new Date('2026-05-08T21:00:00.000Z'),
            sportEventRound: { roundNumber: 2 },
          },
        ],
        golfStanding: {
          eventScoreToPar: -3,
          eventStrokes: 141,
          currentRound: 2,
          currentRoundThru: 9,
          status: 'IN_PROGRESS',
          position: 4,
          displayPosition: 'T4',
          asOf: new Date('2026-05-08T18:00:00.000Z'),
        },
      },
    ]);
    const sportEventGolfTierFindMany = jest.fn().mockResolvedValue([
      {
        id: 'tier-a',
        sportEventId: eventId,
        tierKey: 'A',
        label: 'A',
        tierNumber: 1,
        defaultPickCount: 1,
        valuations: [
          {
            sportEventParticipantId,
            tierOrderIndex: 1,
            price: 19,
            sportEventParticipant: { participantId },
          },
        ],
      },
    ]);
    const service = new AdminEventBrowserService({
      sportEvent: { findUnique },
      sportEventParticipant: { findMany },
      sportEventGolfTier: { findMany: sportEventGolfTierFindMany },
    } as never);

    const response = await service.listEventParticipants(eventId);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: eventId } }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sportEventId: eventId } }),
    );
    expect(response?.participants).toEqual([
      expect.objectContaining({
        id: sportEventParticipantId,
        participantName: 'Avery Driver',
        status: 'ACTIVE',
        worldRanking: 3,
        oddsToWin: 12.5,
        valuationPrice: 19,
        roundCount: 2,
        totalStrokes: 141,
        scoreToPar: -3,
        golfStanding: expect.objectContaining({
          eventScoreToPar: -3,
          eventStrokes: 141,
          currentRound: 2,
          currentRoundThru: 9,
          status: 'in-progress',
          position: 4,
          displayPosition: 'T4',
          asOf: '2026-05-08T18:00:00.000Z',
        }),
      }),
    ]);
  });

  it('pool-master-uvc: derives the legacy status string from isActive/inactiveReason for a withdrawn golfer', async () => {
    const findUnique = jest.fn().mockResolvedValue(createEventRow());
    const findMany = jest.fn().mockResolvedValue([
      {
        id: sportEventParticipantId,
        sportEventId: eventId,
        participantId,
        isActive: false,
        inactiveReason: 'WITHDRAWN',
        worldRanking: null,
        oddsToWin: null,
        seedNumber: null,
        updatedAt: new Date('2026-05-01T12:00:00.000Z'),
        participant: {
          name: 'Withdrawn Golfer',
          shortName: null,
          nationality: null,
        },
        valuations: [],
        golfRounds: [],
        golfStanding: null,
      },
      {
        id: randomUUID(),
        sportEventId: eventId,
        participantId: randomUUID(),
        isActive: false,
        inactiveReason: null,
        worldRanking: null,
        oddsToWin: null,
        seedNumber: null,
        updatedAt: new Date('2026-05-01T12:00:00.000Z'),
        participant: {
          name: 'No-Reason Inactive Golfer',
          shortName: null,
          nationality: null,
        },
        golfRounds: [],
        golfStanding: null,
      },
    ]);
    const service = new AdminEventBrowserService({
      sportEvent: { findUnique },
      sportEventParticipant: { findMany },
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);

    const deriveSpy = jest.spyOn(SharedDomainEnums, 'deriveLegacyParticipantStatus');

    const response = await service.listEventParticipants(eventId);

    // Proves this mapper delegates to the shared derivation (pool-master-uvc) rather
    // than a second, silently-diverging copy of the same ternary — the derivation's
    // own branches are covered directly in tests/unit/shared/domain-models.test.ts.
    expect(deriveSpy).toHaveBeenCalledWith(false, 'WITHDRAWN');
    expect(deriveSpy).toHaveBeenCalledWith(false, null);
    deriveSpy.mockRestore();

    expect(response?.participants).toEqual([
      expect.objectContaining({ participantName: 'Withdrawn Golfer', status: 'WITHDRAWN' }),
      expect.objectContaining({ participantName: 'No-Reason Inactive Golfer', status: 'INACTIVE' }),
    ]);
  });

  it('pool-master-eux.2 falls back to round aggregation when no golf standing exists yet', async () => {
    const findUnique = jest.fn().mockResolvedValue(createEventRow());
    const findMany = jest.fn().mockResolvedValue([
      {
        id: sportEventParticipantId,
        sportEventId: eventId,
        participantId,
        isActive: true,
        inactiveReason: null,
        worldRanking: null,
        oddsToWin: null,
        seedNumber: null,
        updatedAt: new Date('2026-05-01T12:00:00.000Z'),
        participant: {
          name: 'Fallback Golfer',
          shortName: null,
          nationality: null,
        },
        valuations: [],
        golfRounds: [
          {
            strokes: 69,
            scoreToPar: -3,
            thru: 18,
            status: 'COMPLETED',
            completedAt: new Date('2026-05-07T21:00:00.000Z'),
            sportEventRound: { roundNumber: 1 },
          },
          {
            strokes: 73,
            scoreToPar: 1,
            thru: 18,
            status: 'COMPLETED',
            completedAt: new Date('2026-05-08T21:00:00.000Z'),
            sportEventRound: { roundNumber: 2 },
          },
        ],
        golfStanding: null,
      },
    ]);
    const service = new AdminEventBrowserService({
      sportEvent: { findUnique },
      sportEventParticipant: { findMany },
      sportEventGolfTier: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);

    const response = await service.listEventParticipants(eventId);

    expect(response?.participants[0]).toMatchObject({
      participantName: 'Fallback Golfer',
      roundCount: 2,
      totalStrokes: 142,
      scoreToPar: -2,
    });
    expect(response?.participants[0]).not.toHaveProperty('golfStanding');
  });

  it('returns EVENT_NOT_FOUND when a participant modal targets a missing event', async () => {
    const service = {
      listEventParticipants: jest.fn().mockResolvedValue(null),
    } as unknown as AdminEventBrowserService;
    const reply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    const handler = createEventBrowserAdminHandlers(service);

    await handler.listEventParticipants(
      {
        params: { eventId },
      } as never,
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'EVENT_NOT_FOUND' }),
      }),
    );
  });
});

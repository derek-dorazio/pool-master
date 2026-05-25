import { randomUUID } from 'crypto';
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
        status: 'ACTIVE',
        worldRanking: 3,
        oddsToWin: { toNumber: () => 12.5 },
        seedNumber: null,
        updatedAt: new Date('2026-05-01T12:00:00.000Z'),
        participant: {
          name: 'Avery Driver',
          shortName: 'A. Driver',
          nationality: 'US',
        },
        valuations: [
          {
            price: 19,
            tier: 'A',
            orderIndex: 1,
          },
        ],
        golfRounds: [
          {
            round: 1,
            strokes: 70,
            scoreToPar: -2,
            status: 'COMPLETE',
            completedAt: new Date('2026-05-07T21:00:00.000Z'),
          },
          {
            round: 2,
            strokes: 71,
            scoreToPar: -1,
            status: 'COMPLETE',
            completedAt: new Date('2026-05-08T21:00:00.000Z'),
          },
        ],
      },
    ]);
    const service = new AdminEventBrowserService({
      sportEvent: { findUnique },
      sportEventParticipant: { findMany },
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
        worldRanking: 3,
        oddsToWin: 12.5,
        valuationPrice: 19,
        roundCount: 2,
        totalStrokes: 141,
        scoreToPar: -3,
      }),
    ]);
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

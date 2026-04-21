import { randomUUID } from 'crypto';
import { createEventHandlers } from '../../../packages/core-api/src/modules/events/handler';
import { EventService } from '../../../packages/core-api/src/modules/events/service';

describe('event service and handler', () => {
  it('lists events with default limit and maps loaded participant counts', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: randomUUID(),
        sport: 'GOLF',
        name: 'Mock Major',
        venue: null,
        location: null,
        status: 'SCHEDULED',
        startDate: new Date('2026-04-12T16:00:00.000Z'),
        endDate: null,
        releaseAt: new Date('2026-04-09T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-11T12:00:00.000Z'),
        participantCount: 144,
        fieldLocked: false,
        metadata: {},
        _count: {
          sportEventParticipants: 72,
        },
      },
    ]);

    const service = new EventService({ findMany } as never);

    const result = await service.listEvents({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        where: {},
      }),
    );
    expect(result[0]).toMatchObject({
      loadedParticipantCount: 72,
      providerFieldLocked: false,
    });
  });

  it('filters events by sport and status when provided', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new EventService({ findMany } as never);

    await service.listEvents({
      sport: 'UFC',
      status: 'SCHEDULED',
      limit: 10,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sport: 'UFC',
          status: 'SCHEDULED',
        },
        take: 10,
      }),
    );
  });

  it('returns mapped readiness response from the event handler', async () => {
    const eventService = {
      listEvents: jest.fn().mockResolvedValue([
        {
          id: 'event-1',
          sport: 'GOLF',
          name: 'Ready Event',
          venue: null,
          location: null,
          status: 'SCHEDULED',
          startDate: new Date('2026-04-12T16:00:00.000Z'),
          endDate: null,
          releaseAt: new Date('2026-04-09T12:00:00.000Z'),
          fieldLocksAt: new Date('2026-04-11T12:00:00.000Z'),
          participantCount: 144,
          loadedParticipantCount: 144,
          providerFieldLocked: false,
        },
      ]),
    } as unknown as EventService;

    const handler = createEventHandlers(eventService);
    const response = await handler.listEvents(
      {
        query: { sport: 'GOLF', limit: 10 },
        contextLogger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
        log: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
      } as never,
      {} as never,
    );

    expect(eventService.listEvents).toHaveBeenCalledWith({ sport: 'GOLF', limit: 10 });
    expect(response.events).toEqual([
      expect.objectContaining({
        id: 'event-1',
        readinessStatus: 'FIELD_LOCKED',
        contestEligible: false,
      }),
    ]);
  });
});

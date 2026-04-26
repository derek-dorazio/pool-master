import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Sport } from '@poolmaster/shared/domain';
import type { EventStatusDto } from '@poolmaster/shared/dto/events.dto';

export interface EventListQueryInput {
  sport?: string;
  status?: string;
  limit?: number;
}

export interface EventListItemRow {
  id: string;
  sport: Sport;
  name: string;
  venue: string | null;
  location: string | null;
  status: EventStatusDto;
  startDate: Date;
  endDate: Date | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  participantCount: number | null;
  loadedParticipantCount: number;
  providerFieldLocked: boolean;
}

type SportEventFindMany = PrismaClient['sportEvent']['findMany'];

export class EventService {
  constructor(
    private readonly eventReader: {
      findMany: SportEventFindMany;
    },
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listEvents(query: EventListQueryInput): Promise<EventListItemRow[]> {
    const resolvedLimit = query.limit ?? 25;
    this.logger?.debug(
      {
        action: 'events.list.start',
        data: {
          sport: query.sport ?? null,
          status: query.status ?? null,
          limit: resolvedLimit,
        },
      },
      'Listing events',
    );

    try {
      const events = await this.eventReader.findMany({
        where: {
          ...(query.sport ? { sport: query.sport } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        include: {
          _count: {
            select: {
              sportEventParticipants: true,
            },
          },
        },
        orderBy: { startDate: 'asc' },
        take: resolvedLimit,
      });

      const mappedEvents = events.map((event) => ({
        ...event,
        sport: event.sport as Sport,
        status: event.status as EventStatusDto,
        releaseAt: event.releaseAt,
        fieldLocksAt: event.fieldLocksAt,
        loadedParticipantCount: event._count.sportEventParticipants,
        providerFieldLocked: event.fieldLocked,
      }));

      this.logger?.info(
        {
          action: 'events.list.success',
          data: {
            count: mappedEvents.length,
            sport: query.sport ?? null,
            status: query.status ?? null,
          },
        },
        'Listed events',
      );

      this.logger?.debug(
        {
          action: 'events.list.complete',
          data: {
            count: mappedEvents.length,
            events: mappedEvents.slice(0, 25).map((event) => ({
              id: event.id,
              sport: event.sport,
              name: event.name,
              status: event.status,
              startDate: event.startDate.toISOString(),
              releaseAt: event.releaseAt.toISOString(),
              fieldLocksAt: event.fieldLocksAt.toISOString(),
              participantCount: event.participantCount,
              loadedParticipantCount: event.loadedParticipantCount,
              providerFieldLocked: event.providerFieldLocked,
            })),
          },
        },
        'Completed events listing',
      );

      return mappedEvents;
    } catch (error) {
      this.logger?.error(
        {
          action: 'events.list.failed',
          err: error,
          data: {
            sport: query.sport ?? null,
            status: query.status ?? null,
            limit: resolvedLimit,
          },
        },
        'Failed to list events',
      );
      throw error;
    }
  }
}

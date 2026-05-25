import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type {
  AdminEventListQuery,
  AdminEventParticipantListResponse,
  AdminEventSummaryDto,
} from '@poolmaster/shared/dto';
import {
  mapAdminEventParticipantToDto,
  mapAdminEventSummaryToDto,
} from '../../mappers';

export class AdminEventBrowserService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listEvents(query: AdminEventListQuery): Promise<AdminEventSummaryDto[]> {
    const limit = query.limit ?? 100;

    this.logger?.debug({
      action: 'adminEventBrowser.listEvents.start',
      data: {
        sport: query.sport ?? null,
        status: query.status ?? null,
        limit,
      },
    }, 'Listing current-state events for root-admin browser');

    const rows = await this.prisma.sportEvent.findMany({
      where: {
        ...(query.sport ? { sport: query.sport } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [
        { startDate: 'asc' },
        { name: 'asc' },
      ],
      take: limit,
      include: {
        _count: {
          select: {
            sportEventParticipants: true,
          },
        },
      },
    });

    const events = rows.map(mapAdminEventSummaryToDto);

    this.logger?.info({
      action: 'adminEventBrowser.listEvents.success',
      data: {
        returnedCount: events.length,
        sport: query.sport ?? null,
        status: query.status ?? null,
      },
    }, 'Listed current-state events for root-admin browser');

    return events;
  }

  async listEventParticipants(
    eventId: string,
  ): Promise<AdminEventParticipantListResponse | null> {
    this.logger?.debug({
      action: 'adminEventBrowser.listEventParticipants.start',
      data: { eventId },
    }, 'Listing current-state event participants for root-admin browser');

    const event = await this.prisma.sportEvent.findUnique({
      where: { id: eventId },
      include: {
        _count: {
          select: {
            sportEventParticipants: true,
          },
        },
      },
    });

    if (!event) {
      this.logger?.warn({
        action: 'adminEventBrowser.listEventParticipants.notFound',
        data: { eventId },
      }, 'Root-admin event participant browser target was not found');
      return null;
    }

    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: eventId },
      orderBy: [
        { worldRanking: { sort: 'asc', nulls: 'last' } },
        { seedNumber: { sort: 'asc', nulls: 'last' } },
        { participant: { name: 'asc' } },
      ],
      include: {
        participant: {
          select: {
            name: true,
            shortName: true,
            nationality: true,
          },
        },
        valuations: {
          orderBy: [
            { orderIndex: { sort: 'asc', nulls: 'last' } },
            { tier: 'asc' },
          ],
          select: {
            price: true,
            tier: true,
            orderIndex: true,
          },
        },
        golfRounds: {
          orderBy: { round: 'asc' },
          select: {
            round: true,
            strokes: true,
            scoreToPar: true,
            status: true,
            completedAt: true,
          },
        },
      },
    });

    const response = {
      event: mapAdminEventSummaryToDto(event),
      participants: rows.map(mapAdminEventParticipantToDto),
    };

    this.logger?.info({
      action: 'adminEventBrowser.listEventParticipants.success',
      data: {
        eventId,
        participantCount: response.participants.length,
      },
    }, 'Listed current-state event participants for root-admin browser');

    return response;
  }
}

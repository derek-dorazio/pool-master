import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { SportEventStatus } from '@poolmaster/shared/domain';
import type {
  AdminEventListQuery,
  AdminEventParticipantListResponse,
  AdminEventSummaryDto,
} from '@poolmaster/shared/dto';
import {
  mapAdminEventParticipantToDto,
  mapAdminEventSummaryToDto,
} from '../../mappers';
import { GolfTierService } from '../golf/golf-tier-service';

export class AdminEventBrowserService {
  private readonly golfTierService: GolfTierService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {
    this.golfTierService = new GolfTierService(prisma, logger);
  }

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
        ...(query.status ? { status: query.status as SportEventStatus } : {}),
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
        golfRounds: {
          orderBy: { sportEventRound: { roundNumber: 'asc' } },
          select: {
            strokes: true,
            scoreToPar: true,
            thru: true,
            status: true,
            completedAt: true,
            sportEventRound: {
              select: { roundNumber: true },
            },
          },
        },
        golfStanding: {
          select: {
            eventScoreToPar: true,
            eventStrokes: true,
            currentRound: true,
            currentRoundThru: true,
            status: true,
            position: true,
            displayPosition: true,
            asOf: true,
          },
        },
      },
    });

    const valuations = await this.golfTierService.getEffectiveValuationsForSportEvent(eventId);
    const valuationBySportEventParticipantId = new Map(
      valuations.map((valuation) => [valuation.sportEventParticipantId, valuation]),
    );

    const response = {
      event: mapAdminEventSummaryToDto(event),
      participants: rows.map((row) => {
        const valuation = valuationBySportEventParticipantId.get(row.id);
        return mapAdminEventParticipantToDto({
          ...row,
          ...(valuation
            ? {
                golfValuation: {
                  price: valuation.price,
                  tierLabel: valuation.tierLabel,
                  tierOrderIndex: valuation.tierOrderIndex,
                },
              }
            : {}),
        });
      }),
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

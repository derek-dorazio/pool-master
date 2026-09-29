import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { SportEventRepository } from '@poolmaster/shared/db';
import type { AdminEventParticipantListResponse } from '@poolmaster/shared/dto';
import {
  mapAdminEventParticipantToDto,
  mapSportEventToDto,
} from '../../mappers';
import { GolfTierService } from '../golf/golf-tier-service';

export class AdminEventBrowserService {
  private readonly golfTierService: GolfTierService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sportEvents: SportEventRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {
    this.golfTierService = new GolfTierService(prisma, logger);
  }

  async listEventParticipants(
    eventId: string,
  ): Promise<AdminEventParticipantListResponse | null> {
    this.logger?.debug({
      action: 'adminEventBrowser.listEventParticipants.start',
      data: { eventId },
    }, 'Listing current-state event participants for root-admin browser');

    const event = await this.sportEvents.findById(eventId);
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
        { ranking: { sort: 'asc', nulls: 'last' } },
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
        rounds: {
          orderBy: { sportEventRound: { roundNumber: 'asc' } },
          select: {
            status: true,
            completedAt: true,
            sportEventRound: {
              select: { roundNumber: true },
            },
            golf: { select: { strokes: true, scoreToPar: true, thru: true } },
          },
        },
        standing: {
          select: {
            currentRound: true,
            status: true,
            position: true,
            displayPosition: true,
            asOf: true,
            golf: { select: { eventScoreToPar: true, eventStrokes: true, currentRoundThru: true } },
          },
        },
      },
    });

    const valuations = await this.golfTierService.getEffectiveValuationsForSportEvent(eventId);
    const valuationBySportEventParticipantId = new Map(
      valuations.map((valuation) => [valuation.sportEventParticipantId, valuation]),
    );

    const response = {
      event: mapSportEventToDto(event, (await this.sportEvents.countParticipants([event.id])).get(event.id) ?? 0),
      participants: rows.map((row) => {
        const valuation = valuationBySportEventParticipantId.get(row.id);
        const { rounds, standing, ...participant } = row;
        return mapAdminEventParticipantToDto({
          ...participant,
          golfRounds: rounds.flatMap(({ golf, ...round }) => (golf ? [{ ...round, ...golf }] : [])),
          golfStanding: standing?.golf
            ? { ...standing, ...standing.golf }
            : null,
          ...(valuation
            ? {
                valuation: {
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

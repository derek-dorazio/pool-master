/**
 * GolfPlayerService — the golf master roster (plans/124 §4.4a/§5.2). Manual
 * mode has no sync to populate `Participant`, so the roster needs its own
 * admin surface. This is a thin, golf-scoped wrapper over the existing
 * cross-sport `ParticipantService` — it does not duplicate its create/
 * update/search logic, only resolves `Sport.GOLF`'s `Sport` row id and
 * shapes the response for the admin-golf DTOs.
 *
 * "Removing" a golfer from the master roster is `updatePlayer({ status:
 * 'INACTIVE' })`, never a hard delete — the roster is referenced by
 * potentially years of historical `SportEventParticipant`/`ContestEntryPick`
 * rows. No delete route exists or is planned.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ParticipantStatus, ParticipantType, Sport, type Participant } from '@poolmaster/shared/domain';
import type { ParticipantService } from '../participants/service';
import { ParticipantNotFoundError } from '../participants/service';
import { requireSportRow } from '../sport-catalog/sport-row';

export class GolfPlayerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GolfPlayerError';
  }
}

export interface GolfPlayerRow {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  shortName: string | null;
  nationality: string | null;
  position: string | null;
  teamAffiliation: string | null;
  externalId: string | null;
  status: ParticipantStatus;
  providerMappingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GolfPlayerDetail extends GolfPlayerRow {
  providerMappings: Array<{ providerId: string; externalId: string; confidence: string }>;
}

export interface CreateGolfPlayerInput {
  name: string;
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  position?: string;
  teamAffiliation?: string;
  externalId?: string;
}

export interface UpdateGolfPlayerInput {
  name?: string;
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  position?: string;
  teamAffiliation?: string;
  externalId?: string;
  status?: ParticipantStatus;
}

const SEARCH_LIMIT = 200;

export class GolfPlayerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly participantService: ParticipantService,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listPlayers(options: { status?: ParticipantStatus; search?: string } = {}): Promise<GolfPlayerRow[]> {
    const sportRow = await requireSportRow(this.prisma, Sport.GOLF);
    const { participants } = await this.participantService.search({
      query: options.search,
      filters: { sportId: sportRow.id, status: [options.status ?? ParticipantStatus.ACTIVE] },
      limit: SEARCH_LIMIT,
    });
    const counts = await this.mappingCounts(participants.map((participant) => participant.id));
    return participants.map((participant) => toGolfPlayerRow(participant, counts.get(participant.id) ?? 0));
  }

  async createPlayer(input: CreateGolfPlayerInput): Promise<GolfPlayerRow> {
    const sportRow = await requireSportRow(this.prisma, Sport.GOLF);
    const participant = await this.participantService.create({
      sportId: sportRow.id,
      participantType: ParticipantType.INDIVIDUAL,
      ...input,
    });
    this.logger?.info({ participantId: participant.id }, 'Created golf player');
    return toGolfPlayerRow(participant, 0);
  }

  async getPlayer(participantId: string): Promise<GolfPlayerDetail | null> {
    const sportRow = await requireSportRow(this.prisma, Sport.GOLF);
    const participant = await this.participantService.findById(participantId);
    if (!participant || participant.sportId !== sportRow.id) {
      return null;
    }
    const mappings = await this.participantService.getProviderMappings(participantId);
    return {
      ...toGolfPlayerRow(participant, mappings.length),
      providerMappings: mappings.map((mapping) => ({
        providerId: mapping.providerId,
        externalId: mapping.externalId,
        confidence: mapping.confidence,
      })),
    };
  }

  async updatePlayer(participantId: string, input: UpdateGolfPlayerInput): Promise<GolfPlayerDetail> {
    const sportRow = await requireSportRow(this.prisma, Sport.GOLF);
    const existing = await this.participantService.findById(participantId);
    if (!existing || existing.sportId !== sportRow.id) {
      throw new GolfPlayerError(`Golf player ${participantId} was not found.`, 'PLAYER_NOT_FOUND', 404);
    }
    try {
      const participant = await this.participantService.update(participantId, input);
      const mappings = await this.participantService.getProviderMappings(participantId);
      return {
        ...toGolfPlayerRow(participant, mappings.length),
        providerMappings: mappings.map((mapping) => ({
          providerId: mapping.providerId,
          externalId: mapping.externalId,
          confidence: mapping.confidence,
        })),
      };
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) {
        throw new GolfPlayerError(`Golf player ${participantId} was not found.`, 'PLAYER_NOT_FOUND', 404);
      }
      throw err;
    }
  }

  private async mappingCounts(participantIds: string[]): Promise<Map<string, number>> {
    if (participantIds.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.participantProviderMapping.groupBy({
      by: ['participantId'],
      where: { participantId: { in: participantIds } },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.participantId, row._count._all]));
  }
}

function toGolfPlayerRow(participant: Participant, providerMappingCount: number): GolfPlayerRow {
  return {
    id: participant.id,
    name: participant.name,
    firstName: participant.firstName ?? null,
    lastName: participant.lastName ?? null,
    shortName: participant.shortName ?? null,
    nationality: participant.nationality ?? null,
    position: participant.position ?? null,
    teamAffiliation: participant.teamAffiliation ?? null,
    externalId: participant.externalId ?? null,
    status: participant.status,
    providerMappingCount,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}

/**
 * ParticipantService — participant CRUD and search.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRepository,
  ParticipantProviderMappingRepository,
  ParticipantSearchFilters,
} from '@poolmaster/shared/db';
import type {
  Participant,
  ParticipantProviderMapping,
  InjuryStatus,
} from '@poolmaster/shared/domain';
import { InjuryStatusCode, ParticipantStatus } from '@poolmaster/shared/domain';
import type { ParticipantType, MappingConfidence } from '@poolmaster/shared/domain';

// --- Input DTOs ---

export interface CreateParticipantInput {
  sportId: string;
  name: string;
  participantType: ParticipantType;
  externalId?: string;
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  role?: string;
  teamAffiliation?: string;
  externalIds?: Record<string, string>;
}

export interface UpdateParticipantInput {
  name?: string;
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  role?: string;
  teamAffiliation?: string;
  status?: Participant['status'];
  injuryStatus?: InjuryStatus;
  photoUrl?: string;
  externalIds?: Record<string, string>;
}

export interface SearchParticipantsInput {
  query?: string;
  filters: ParticipantSearchFilters;
}

// --- Default values ---

const DEFAULT_INJURY_STATUS: InjuryStatus = { status: InjuryStatusCode.HEALTHY };

// --- Service ---

export class ParticipantService {
  constructor(
    private readonly participantRepo: ParticipantRepository,
    private readonly providerMappingRepo: ParticipantProviderMappingRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async findById(id: string): Promise<Participant | null> {
    return this.participantRepo.findById(id);
  }

  async findBySport(sportId: string): Promise<Participant[]> {
    return this.participantRepo.findBySport(sportId);
  }

  /** The whole result for the query and filters — narrowed, never paged (§16). */
  async search(input: SearchParticipantsInput): Promise<Participant[]> {
    const participants = await this.participantRepo.search(input.query ?? '', input.filters);
    this.logger?.info(
      { action: 'participants.search.success', data: { query: input.query ?? '', filters: input.filters, count: participants.length } },
      'Searched participants',
    );
    return participants;
  }

  async create(input: CreateParticipantInput): Promise<Participant> {
    this.logger?.debug(
      {
        action: 'participants.create.start',
        data: {
          sportId: input.sportId,
          participantType: input.participantType,
          hasExternalId: input.externalId !== undefined,
        },
      },
      'Creating participant',
    );

    try {
      const participant = await this.participantRepo.create({
        sportId: input.sportId,
        name: input.name,
        participantType: input.participantType,
        externalId: input.externalId,
        firstName: input.firstName,
        lastName: input.lastName,
        shortName: input.shortName,
        nationality: input.nationality,
        role: input.role,
        teamAffiliation: input.teamAffiliation,
        status: ParticipantStatus.ACTIVE,
        injuryStatus: DEFAULT_INJURY_STATUS,
        externalIds: input.externalIds ?? {},
      });

      this.logger?.info(
        {
          action: 'participants.create.success',
          data: {
            participantId: participant.id,
            sportId: participant.sportId,
          },
        },
        'Created participant',
      );

      return participant;
    } catch (error) {
      this.logger?.error(
        {
          action: 'participants.create.failed',
          err: error,
          data: {
            sportId: input.sportId,
            participantType: input.participantType,
          },
        },
        'Participant creation failed',
      );
      throw error;
    }
  }

  async update(id: string, input: UpdateParticipantInput): Promise<Participant> {
    this.logger?.debug(
      {
        action: 'participants.update.start',
        data: {
          participantId: id,
          updatedFields: Object.keys(input),
        },
      },
      'Updating participant',
    );

    const existing = await this.participantRepo.findById(id);
    if (!existing) {
      this.logger?.warn(
        {
          action: 'participants.update.not_found',
          data: {
            participantId: id,
          },
        },
        'Participant update target not found',
      );
      throw new ParticipantNotFoundError(id);
    }

    try {
      const participant = await this.participantRepo.update(id, input);
      this.logger?.info(
        {
          action: 'participants.update.success',
          data: {
            participantId: id,
            updatedFields: Object.keys(input),
          },
        },
        'Updated participant',
      );
      return participant;
    } catch (error) {
      this.logger?.error(
        {
          action: 'participants.update.failed',
          err: error,
          data: {
            participantId: id,
            updatedFields: Object.keys(input),
          },
        },
        'Participant update failed',
      );
      throw error;
    }
  }

  // --- Provider Mappings ---

  async getProviderMappings(participantId: string): Promise<ParticipantProviderMapping[]> {
    return this.providerMappingRepo.findByParticipant(participantId);
  }

  async findByProvider(
    providerId: string,
    externalId: string,
  ): Promise<Participant | null> {
    return this.participantRepo.findByExternalId(providerId, externalId);
  }

  async addProviderMapping(
    participantId: string,
    providerId: string,
    externalId: string,
    confidence: MappingConfidence,
  ): Promise<ParticipantProviderMapping> {
    return this.providerMappingRepo.create({
      participantId,
      providerId,
      externalId,
      confidence,
      mappedAt: new Date(),
    });
  }
}

export class ParticipantNotFoundError extends Error {
  constructor(participantId: string) {
    super(`Participant not found: ${participantId}`);
    this.name = 'ParticipantNotFoundError';
  }
}

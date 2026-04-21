/**
 * ParticipantService — participant CRUD, search, and season record management.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantRepository,
  ParticipantSeasonRecordRepository,
  ParticipantProviderMappingRepository,
  ParticipantSearchFilters,
} from '@poolmaster/shared/db';
import type {
  Participant,
  ParticipantSeasonRecord,
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
  position?: string;
  teamAffiliation?: string;
  metadata?: Record<string, unknown>;
  externalIds?: Record<string, string>;
}

export interface UpdateParticipantInput {
  name?: string;
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  position?: string;
  teamAffiliation?: string;
  status?: Participant['status'];
  injuryStatus?: InjuryStatus;
  photoUrl?: string;
  metadata?: Record<string, unknown>;
  externalIds?: Record<string, string>;
}

export interface SearchParticipantsInput {
  query?: string;
  filters: ParticipantSearchFilters;
  limit?: number;
  offset?: number;
}

// --- Default values ---

const DEFAULT_INJURY_STATUS: InjuryStatus = { status: InjuryStatusCode.HEALTHY };
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;

// --- Service ---

export class ParticipantService {
  constructor(
    private readonly participantRepo: ParticipantRepository,
    private readonly seasonRecordRepo: ParticipantSeasonRecordRepository,
    private readonly providerMappingRepo: ParticipantProviderMappingRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async findById(id: string): Promise<Participant | null> {
    return this.participantRepo.findById(id);
  }

  async findBySport(sportId: string): Promise<Participant[]> {
    return this.participantRepo.findBySport(sportId);
  }

  async search(input: SearchParticipantsInput): Promise<{ participants: Participant[]; total: number }> {
    const limit = Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
    const offset = input.offset ?? 0;

    this.logger?.debug(
      {
        action: 'participants.search.start',
        data: {
          query: input.query ?? '',
          filters: input.filters,
          requestedLimit: input.limit ?? null,
          resolvedLimit: limit,
          offset,
        },
      },
      'Searching participants',
    );

    try {
      const result = await this.participantRepo.search(input.query ?? '', input.filters, limit, offset);
      this.logger?.info(
        {
          action: 'participants.search.success',
          data: {
            total: result.total,
            returnedCount: result.participants.length,
            resolvedLimit: limit,
            offset,
          },
        },
        'Searched participants',
      );
      return result;
    } catch (error) {
      this.logger?.error(
        {
          action: 'participants.search.failed',
          err: error,
          data: {
            query: input.query ?? '',
            filters: input.filters,
            requestedLimit: input.limit ?? null,
            offset,
          },
        },
        'Participant search failed',
      );
      throw error;
    }
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
        position: input.position,
        teamAffiliation: input.teamAffiliation,
        status: ParticipantStatus.ACTIVE,
        injuryStatus: DEFAULT_INJURY_STATUS,
        externalIds: input.externalIds ?? {},
        metadata: input.metadata ?? {},
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

  // --- Season Records ---

  async getSeasonRecord(
    participantId: string,
    season: string,
  ): Promise<ParticipantSeasonRecord | null> {
    this.logger?.debug(
      {
        action: 'participants.season_record.get.start',
        data: {
          participantId,
          season,
        },
      },
      'Fetching participant season record',
    );
    try {
      const record = await this.seasonRecordRepo.findByParticipantAndSeason(participantId, season);
      this.logger?.info(
        {
          action: 'participants.season_record.get.complete',
          data: {
            participantId,
            season,
            found: record !== null,
          },
        },
        'Fetched participant season record',
      );
      return record;
    } catch (error) {
      this.logger?.error(
        {
          action: 'participants.season_record.get.failed',
          err: error,
          data: {
            participantId,
            season,
          },
        },
        'Failed to fetch participant season record',
      );
      throw error;
    }
  }

  async getSeasonRecords(participantId: string): Promise<ParticipantSeasonRecord[]> {
    this.logger?.debug(
      {
        action: 'participants.season_records.list.start',
        data: {
          participantId,
        },
      },
      'Listing participant season records',
    );
    try {
      const records = await this.seasonRecordRepo.findByParticipant(participantId);
      this.logger?.info(
        {
          action: 'participants.season_records.list.success',
          data: {
            participantId,
            count: records.length,
          },
        },
        'Listed participant season records',
      );
      return records;
    } catch (error) {
      this.logger?.error(
        {
          action: 'participants.season_records.list.failed',
          err: error,
          data: {
            participantId,
          },
        },
        'Failed to list participant season records',
      );
      throw error;
    }
  }

  async upsertSeasonRecord(
    record: Omit<ParticipantSeasonRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantSeasonRecord> {
    return this.seasonRecordRepo.upsert(record);
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

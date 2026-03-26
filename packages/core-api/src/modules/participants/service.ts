/**
 * ParticipantService — participant CRUD, search, and season record management.
 */

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
import type { ParticipantType, Sport, FormTrend, MappingConfidence } from '@poolmaster/shared/domain';

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
    return this.participantRepo.search(input.query ?? '', input.filters, limit, offset);
  }

  async create(input: CreateParticipantInput): Promise<Participant> {
    return this.participantRepo.create({
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
  }

  async update(id: string, input: UpdateParticipantInput): Promise<Participant> {
    const existing = await this.participantRepo.findById(id);
    if (!existing) {
      throw new ParticipantNotFoundError(id);
    }
    return this.participantRepo.update(id, input);
  }

  // --- Season Records ---

  async getSeasonRecord(
    participantId: string,
    season: string,
  ): Promise<ParticipantSeasonRecord | null> {
    return this.seasonRecordRepo.findByParticipantAndSeason(participantId, season);
  }

  async getSeasonRecords(participantId: string): Promise<ParticipantSeasonRecord[]> {
    return this.seasonRecordRepo.findByParticipant(participantId);
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

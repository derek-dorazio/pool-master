/**
 * ParticipantService — participant CRUD and search.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  ParticipantFeedId,
  ParticipantRepository,
  ParticipantProviderMappingRepository,
  ParticipantSearchFilters,
} from '@poolmaster/shared/db';
import type {
  Participant,
  ParticipantProviderMapping,
  InjuryStatus, ParticipantType
} from '@poolmaster/shared/domain';
import { InjuryStatusCode, ParticipantStatus } from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import { DomainEventType, type DomainEvents } from '../domain-events';

// --- Input DTOs ---

export interface CreateParticipantInput {
  sportLeagueId: string;
  ranking?: number | null;
  name: string;
  participantType: ParticipantType;
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  role?: string;
  teamAffiliation?: string;
  /** The sport league's sync provider's id for the participant, mapped in the same write (#2096). */
  feedId?: string;
  /** A test participant for a test slot's field (#2096); it never takes a feed id. */
  isTestData?: boolean;
}

export interface UpdateParticipantInput {
  name?: string;
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  role?: string;
  teamAffiliation?: string;
  ranking?: number | null;
  status?: Participant['status'];
  injuryStatus?: InjuryStatus;
  photoUrl?: string;
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
    /** What follows a mapping (#2069): the mapped feed id's unmapped participant finding resolves. */
    private readonly domainEvents: Pick<DomainEvents, 'collect'>,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async findById(id: string): Promise<Participant | null> {
    return this.participantRepo.findById(id);
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

  /**
   * A participant of the sport league (#2096). A provider-synced league takes exactly two shapes:
   * one with its sync provider's feed id, written with its provider mapping in one transaction, or a
   * test participant (`isTestData`), which never has a mapping. Anything else is 409
   * PARTICIPANT_FEED_ID_REQUIRED, since the sync would make a second participant beside an unmapped
   * one. A league with no feed takes a participant without a feed id, as before. 404
   * SPORT_LEAGUE_NOT_FOUND; 422 TEST_PARTICIPANT_FEED_ID for a test participant given a feed id,
   * SPORT_LEAGUE_NOT_SYNCED for a feed id in a league with no feed; 409 PARTICIPANT_FEED_ID_TAKEN for
   * a feed id the league already maps.
   */
  async create(input: CreateParticipantInput): Promise<Participant> {
    this.logger?.debug(
      { action: 'participants.create.start', data: { sportLeagueId: input.sportLeagueId, participantType: input.participantType, isTestData: input.isTestData === true } },
      'Creating participant',
    );
    const isTestData = input.isTestData === true;
    if (isTestData && input.feedId !== undefined) throw new TestParticipantFeedIdError();
    const syncProviderId = await this.providerMappingRepo.findSyncProviderId(input.sportLeagueId);
    if (syncProviderId === undefined) throw new SportLeagueNotFoundError(input.sportLeagueId);
    if (syncProviderId === null && input.feedId !== undefined) throw new SportLeagueNotSyncedError(input.sportLeagueId);
    if (syncProviderId !== null && !isTestData && input.feedId === undefined) {
      this.logger?.warn(
        { action: 'participants.create.feedIdRequired', data: { sportLeagueId: input.sportLeagueId } },
        'Refused an unmapped participant in a provider-synced sport league',
      );
      throw new ParticipantFeedIdRequiredError(input.sportLeagueId);
    }
    const row = {
      sportLeagueId: input.sportLeagueId,
      ranking: input.ranking ?? null,
      name: input.name,
      participantType: input.participantType,
      firstName: input.firstName,
      lastName: input.lastName,
      shortName: input.shortName,
      nationality: input.nationality,
      role: input.role,
      teamAffiliation: input.teamAffiliation,
      status: ParticipantStatus.ACTIVE,
      injuryStatus: DEFAULT_INJURY_STATUS,
      isTestData,
    };
    let participant: Participant;
    try {
      participant = syncProviderId === null || input.feedId === undefined
        ? await this.participantRepo.create(row)
        : await this.createMapped(row, { providerId: syncProviderId, externalId: input.feedId });
    } catch (error) {
      this.logger?.error(
        { action: 'participants.create.failed', err: error, data: { sportLeagueId: input.sportLeagueId, participantType: input.participantType } },
        'Participant creation failed',
      );
      throw error;
    }
    this.logger?.info(
      { action: 'participants.create.success', data: { participantId: participant.id, sportLeagueId: participant.sportLeagueId, isTestData } },
      'Created participant',
    );
    return participant;
  }

  /** The participant and its feed id's mapping together, with the mapping's follow-ups (#2069). */
  private async createMapped(row: Omit<Participant, 'id' | 'createdAt' | 'updatedAt'>, feedId: ParticipantFeedId): Promise<Participant> {
    const followUps = await this.domainEvents.collect({
      type: DomainEventType.PARTICIPANT_PROVIDER_MAPPED,
      sportLeagueId: row.sportLeagueId,
      providerId: feedId.providerId,
      externalIds: [feedId.externalId],
    });
    const created = await this.participantRepo.createWithProviderMapping(row, feedId, followUps.jobs);
    if (created === null) throw new ParticipantFeedIdTakenError(feedId.externalId);
    followUps.queued();
    return created;
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

  /**
   * Deletes a participant no event field holds (#1400), with its provider identities. 404 PARTICIPANT_NOT_FOUND; 409 PARTICIPANT_IN_USE while any event's field,
   * in any year, has them: the field row is what scores and picks hang from.
   */
  async delete(id: string): Promise<void> {
    const fieldEntries = await this.participantRepo.deleteUnlessOnAField(id);
    if (fieldEntries === null) {
      throw new ParticipantNotFoundError(id);
    }
    if (fieldEntries > 0) {
      this.logger?.warn(
        { action: 'participants.delete.inUse', data: { participantId: id, fieldEntries } },
        'Refused to delete a participant who is on an event field',
      );
      throw new ParticipantInUseError(id, fieldEntries);
    }
    this.logger?.info({ action: 'participants.delete.success', data: { participantId: id } }, 'Deleted participant');
  }

  // --- Provider Mappings ---

  async getProviderMappings(participantId: string): Promise<ParticipantProviderMapping[]> {
    return this.providerMappingRepo.findByParticipant(participantId);
  }

  /**
   * Every identity a provider has for a sport league's participants (#1853): how the Load test
   * data run finds the participant a test player's feed id is already mapped to in that league,
   * so it never makes a second one beside the sync's.
   */
  async listSportLeagueProviderMappings(providerId: string, sportLeagueId: string): Promise<ParticipantProviderMapping[]> {
    const mappings = await this.providerMappingRepo.findByProviderAndSportLeague(providerId, sportLeagueId);
    this.logger?.info(
      { action: 'participants.service.listSportLeagueProviderMappings.success', data: { providerId, sportLeagueId, count: mappings.length } },
      'Listed a provider\'s participant identities in a sport league',
    );
    return mappings;
  }

  /**
   * A root admin binding a provider identity to this participant by hand — how a competitor
   * the provider could not match gets their synced data. An identity already bound to another
   * of the participant's sport league moves here. `providerId` is the Provider row's id: 404
   * PROVIDER_NOT_FOUND for one with no row.
   */
  async bindProviderMapping(
    participantId: string,
    providerId: string,
    externalId: string,
  ): Promise<ParticipantProviderMapping> {
    const participant = await this.participantRepo.findById(participantId);
    if (!participant) {
      throw new ParticipantNotFoundError(participantId);
    }
    if (participant.isTestData) throw new TestParticipantFeedIdError();
    const followUps = await this.domainEvents.collect({
      type: DomainEventType.PARTICIPANT_PROVIDER_MAPPED,
      sportLeagueId: participant.sportLeagueId,
      providerId,
      externalIds: [externalId],
    });
    const mapping = await this.providerMappingRepo.bind({
      participantId,
      sportLeagueId: participant.sportLeagueId,
      participantType: participant.participantType,
      providerId,
      externalId,
      mappedAt: new Date(),
    }, followUps.jobs);
    if (!mapping) {
      this.logger?.warn(
        { action: 'participants.service.bindProviderMapping.providerNotFound', data: { participantId, providerId } },
        'Refused to bind a provider identity of an unknown provider',
      );
      throw new ProviderNotFoundError(providerId);
    }
    followUps.queued();
    this.logger?.info(
      { action: 'participants.service.bindProviderMapping.success', data: { participantId, providerId, externalId } },
      'Bound provider identity to participant',
    );
    return mapping;
  }
}

export class ParticipantNotFoundError extends Error {
  readonly code: ApiErrorCode = 'PARTICIPANT_NOT_FOUND';
  readonly statusCode = 404;

  constructor(participantId: string) {
    super(`Participant not found: ${participantId}`);
    this.name = 'ParticipantNotFoundError';
  }
}

export class ProviderNotFoundError extends Error {
  readonly code: ApiErrorCode = 'PROVIDER_NOT_FOUND';
  readonly statusCode = 404;

  constructor(providerId: string) {
    super(`Provider not found: ${providerId}`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ParticipantInUseError extends Error {
  readonly code: ApiErrorCode = 'PARTICIPANT_IN_USE';
  readonly statusCode = 409;

  constructor(participantId: string, fieldEntries: number) {
    super(`Participant ${participantId} is on ${fieldEntries} event ${fieldEntries === 1 ? 'field' : 'fields'}, so they cannot be deleted.`);
    this.name = 'ParticipantInUseError';
  }
}

/** 409: a provider-synced league takes a participant only with its feed id, or as a test participant (#2096). */
export class ParticipantFeedIdRequiredError extends Error {
  readonly code: ApiErrorCode = 'PARTICIPANT_FEED_ID_REQUIRED';
  readonly statusCode = 409;

  constructor(sportLeagueId: string) {
    super(`Sport league ${sportLeagueId} is provider-synced: a participant needs its provider's feed id, or must be a test participant.`);
    this.name = 'ParticipantFeedIdRequiredError';
  }
}

/** 409: another participant of the league already holds the feed id (#2096). */
export class ParticipantFeedIdTakenError extends Error {
  readonly code: ApiErrorCode = 'PARTICIPANT_FEED_ID_TAKEN';
  readonly statusCode = 409;

  constructor(externalId: string) {
    super(`Another participant of the sport league already has feed id ${externalId}.`);
    this.name = 'ParticipantFeedIdTakenError';
  }
}

/** 422: a test participant never has a provider mapping (#2096). */
export class TestParticipantFeedIdError extends Error {
  readonly code: ApiErrorCode = 'TEST_PARTICIPANT_FEED_ID';
  readonly statusCode = 422;

  constructor() {
    super('A test participant never has a provider feed id.');
    this.name = 'TestParticipantFeedIdError';
  }
}

export class SportLeagueNotFoundError extends Error {
  readonly code: ApiErrorCode = 'SPORT_LEAGUE_NOT_FOUND';
  readonly statusCode = 404;

  constructor(sportLeagueId: string) {
    super(`Sport league ${sportLeagueId} was not found.`);
    this.name = 'SportLeagueNotFoundError';
  }
}

/** 422: a feed id names a participant at the league's sync provider, and this league has none (#2096). */
export class SportLeagueNotSyncedError extends Error {
  readonly code: ApiErrorCode = 'SPORT_LEAGUE_NOT_SYNCED';
  readonly statusCode = 422;

  constructor(sportLeagueId: string) {
    super(`Sport league ${sportLeagueId} has no feed, so a participant of it has no feed id.`);
    this.name = 'SportLeagueNotSyncedError';
  }
}

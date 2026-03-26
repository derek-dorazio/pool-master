/**
 * ContestPoolService — pool creation, resolution, lifecycle, and withdrawal handling.
 */

import type {
  ContestPoolRepository,
  ContestParticipantPoolRepository,
  ParticipantRepository,
} from '@poolmaster/shared/db';
import type {
  ContestPool,
  ContestPoolConfig,
  ContestParticipantPool,
  Participant,
} from '@poolmaster/shared/domain';
import type { PoolType, Sport } from '@poolmaster/shared/domain';

// --- Input DTOs ---

export interface CreatePoolInput {
  contestId: string;
  sport: Sport;
  eventId?: string;
  poolType: PoolType;
  config?: ContestPoolConfig;
}

export interface UpdatePoolInput {
  poolType?: PoolType;
  config?: ContestPoolConfig;
  eventId?: string;
}

// --- Service ---

export class ContestPoolService {
  constructor(
    private readonly poolRepo: ContestPoolRepository,
    private readonly poolParticipantRepo: ContestParticipantPoolRepository,
    private readonly participantRepo: ParticipantRepository,
  ) {}

  /** Creates a new pool config for a contest. Does not resolve participants yet. */
  async createPool(input: CreatePoolInput): Promise<ContestPool> {
    const existing = await this.poolRepo.findByContest(input.contestId);
    if (existing) {
      throw new PoolAlreadyExistsError(input.contestId);
    }

    return this.poolRepo.create({
      contestId: input.contestId,
      sport: input.sport,
      eventId: input.eventId,
      poolType: input.poolType,
      config: input.config ?? {},
      excludedParticipantIds: [],
      poolLocked: false,
    });
  }

  /** Returns the pool config for a contest, or null. */
  async getPool(contestId: string): Promise<ContestPool | null> {
    return this.poolRepo.findByContest(contestId);
  }

  /** Returns the pool with its resolved participants. */
  async getPoolWithParticipants(
    contestId: string,
  ): Promise<{ pool: ContestPool; participants: ContestParticipantPool[] } | null> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) return null;
    const participants = await this.poolParticipantRepo.findByPool(pool.id);
    return { pool, participants };
  }

  /** Updates pool configuration. Cannot update a locked pool. */
  async updatePool(contestId: string, input: UpdatePoolInput): Promise<ContestPool> {
    const pool = await this.requireUnlockedPool(contestId);
    return this.poolRepo.update(pool.id, input);
  }

  /**
   * Resolves the pool: generates the participant list based on pool type and config.
   * Clears and re-populates pool participants. Cannot resolve a locked pool.
   */
  async resolvePool(contestId: string): Promise<{ pool: ContestPool; count: number }> {
    const pool = await this.requireUnlockedPool(contestId);
    const participants = await this.resolveParticipants(pool);

    // Clear existing participants and re-populate
    await this.poolParticipantRepo.deleteByPool(pool.id);

    const entries = participants.map((p, index) => ({
      poolId: pool.id,
      contestId: pool.contestId,
      participantId: p.id,
      ranking: index + 1,
      isAvailable: true,
    }));

    const count = await this.poolParticipantRepo.createMany(entries);
    return { pool, count };
  }

  /** Refreshes the pool — re-resolves from source. Same as resolve but semantically for updates. */
  async refreshPool(contestId: string): Promise<{ pool: ContestPool; count: number }> {
    return this.resolvePool(contestId);
  }

  /** Locks the pool. No more participants can be added or removed after locking. */
  async lockPool(contestId: string): Promise<ContestPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);
    if (pool.poolLocked) throw new PoolAlreadyLockedError(contestId);

    const participants = await this.poolParticipantRepo.findByPool(pool.id);
    if (participants.length === 0) {
      throw new PoolEmptyError(contestId);
    }

    return this.poolRepo.lock(pool.id);
  }

  /** Excludes a participant from the pool. Cannot exclude from a locked pool. */
  async excludeParticipant(contestId: string, participantId: string): Promise<ContestPool> {
    const pool = await this.requireUnlockedPool(contestId);

    const excluded = [...pool.excludedParticipantIds];
    if (!excluded.includes(participantId)) {
      excluded.push(participantId);
    }

    return this.poolRepo.update(pool.id, { excludedParticipantIds: excluded });
  }

  /** Removes a participant exclusion. */
  async removeExclusion(contestId: string, participantId: string): Promise<ContestPool> {
    const pool = await this.requireUnlockedPool(contestId);

    const excluded = pool.excludedParticipantIds.filter((id) => id !== participantId);
    return this.poolRepo.update(pool.id, { excludedParticipantIds: excluded });
  }

  /**
   * Marks a participant as unavailable (withdrawal/scratch) in a locked pool.
   * This is the only mutation allowed on a locked pool.
   */
  async markUnavailable(
    contestId: string,
    participantId: string,
    reason: string,
  ): Promise<ContestParticipantPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);

    const participants = await this.poolParticipantRepo.findByContest(contestId);
    const entry = participants.find((p) => p.participantId === participantId);
    if (!entry) throw new ParticipantNotInPoolError(contestId, participantId);

    return this.poolParticipantRepo.update(entry.id, {
      isAvailable: false,
      unavailableReason: reason,
    });
  }

  /** Re-marks a participant as available (e.g., withdrawal reversed). */
  async markAvailable(
    contestId: string,
    participantId: string,
  ): Promise<ContestParticipantPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);

    const participants = await this.poolParticipantRepo.findByContest(contestId);
    const entry = participants.find((p) => p.participantId === participantId);
    if (!entry) throw new ParticipantNotInPoolError(contestId, participantId);

    return this.poolParticipantRepo.update(entry.id, {
      isAvailable: true,
      unavailableReason: undefined,
    });
  }

  // --- Private helpers ---

  private async requireUnlockedPool(contestId: string): Promise<ContestPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);
    if (pool.poolLocked) throw new PoolLockedError(contestId);
    return pool;
  }

  private async resolveParticipants(pool: ContestPool): Promise<Participant[]> {
    let participants: Participant[];

    switch (pool.poolType) {
      case 'CUSTOM': {
        const ids = pool.config.customParticipantIds ?? [];
        const all = await Promise.all(ids.map((id) => this.participantRepo.findById(id)));
        participants = all.filter((p): p is Participant => p !== null);
        break;
      }
      case 'FULL_SPORT': {
        // Find the sport ID by looking up participants — sport is stored as string on pool
        const result = await this.participantRepo.search('', {
          sport: pool.sport,
          status: ['ACTIVE'],
        });
        participants = result.participants;
        break;
      }
      case 'RANKING_CUTOFF': {
        const maxRank = pool.config.maxRank ?? 100;
        const result = await this.participantRepo.search('', {
          sport: pool.sport,
          status: ['ACTIVE'],
        }, maxRank);
        participants = result.participants;
        break;
      }
      case 'EVENT_FIELD':
      default: {
        // EVENT_FIELD requires sports data integration (Plan 06) to resolve from event.
        // For now, return empty — will be wired when ingestion layer exists.
        participants = [];
        break;
      }
    }

    // Apply exclusions
    const excludedSet = new Set(pool.excludedParticipantIds);
    return participants.filter((p) => !excludedSet.has(p.id));
  }
}

// --- Error classes ---

export class PoolNotFoundError extends Error {
  constructor(contestId: string) {
    super(`Pool not found for contest: ${contestId}`);
    this.name = 'PoolNotFoundError';
  }
}

export class PoolAlreadyExistsError extends Error {
  constructor(contestId: string) {
    super(`Pool already exists for contest: ${contestId}`);
    this.name = 'PoolAlreadyExistsError';
  }
}

export class PoolLockedError extends Error {
  constructor(contestId: string) {
    super(`Pool is locked for contest: ${contestId}`);
    this.name = 'PoolLockedError';
  }
}

export class PoolAlreadyLockedError extends Error {
  constructor(contestId: string) {
    super(`Pool is already locked for contest: ${contestId}`);
    this.name = 'PoolAlreadyLockedError';
  }
}

export class PoolEmptyError extends Error {
  constructor(contestId: string) {
    super(`Cannot lock an empty pool for contest: ${contestId}`);
    this.name = 'PoolEmptyError';
  }
}

export class ParticipantNotInPoolError extends Error {
  constructor(contestId: string, participantId: string) {
    super(`Participant ${participantId} not in pool for contest: ${contestId}`);
    this.name = 'ParticipantNotInPoolError';
  }
}

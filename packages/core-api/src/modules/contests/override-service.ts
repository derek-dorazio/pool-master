/**
 * OverrideService — commissioner safety-valve tools for in-season contest management.
 *
 * Covers contest lifecycle overrides.
 */

import type { ContestRepository } from '@poolmaster/shared/db';
import type { Contest } from '@poolmaster/shared/domain';
import { ContestStatus } from '@poolmaster/shared/domain';

export class OverrideService {
  constructor(private readonly contestRepo: ContestRepository) {}

  // --- Contest Lifecycle Overrides (08-023) ---

  /** Re-opens a completed contest. */
  async reopenContest(contestId: string, _reason: string): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new OverrideError('Contest not found', 'CONTEST_NOT_FOUND');
    }
    if (contest.status !== ContestStatus.COMPLETED) {
      throw new OverrideError(
        'Only completed contests can be reopened',
        'CONTEST_REOPEN_STATUS_INVALID',
      );
    }
    return this.contestRepo.update(contestId, { status: ContestStatus.ACTIVE } as Partial<Contest>);
  }

  /** Force-closes a contest. */
  async closeContest(contestId: string, _reason: string): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new OverrideError('Contest not found', 'CONTEST_NOT_FOUND');
    }
    if (contest.status === ContestStatus.COMPLETED || contest.status === ContestStatus.CANCELLED) {
      throw new OverrideError('Contest is already closed', 'CONTEST_ALREADY_CLOSED');
    }
    return this.contestRepo.update(contestId, {
      status: ContestStatus.COMPLETED,
    } as Partial<Contest>);
  }

  /** Extends the contest end date. */
  async extendDeadline(
    contestId: string,
    newEnd: Date,
    _reason: string,
  ): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new OverrideError('Contest not found', 'CONTEST_NOT_FOUND');
    }
    return this.contestRepo.update(contestId, { endsAt: newEnd } as Partial<Contest>);
  }

  /** Updates the lock time for a contest. */
  async updateLockTime(
    contestId: string,
    newLock: Date,
    _reason: string,
  ): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new OverrideError('Contest not found', 'CONTEST_NOT_FOUND');
    }
    return this.contestRepo.update(contestId, { lockAt: newLock } as Partial<Contest>);
  }
}

export class OverrideError extends Error {
  code: string;

  constructor(reason: string, code = 'CONTEST_OVERRIDE_INVALID') {
    super(reason);
    this.name = 'OverrideError';
    this.code = code;
  }
}

/**
 * OverrideService — commissioner safety-valve tools for in-season contest management.
 *
 * Covers contest lifecycle overrides. None takes a reason: each accepted one and discarded it, with
 * nowhere to record it once the audit log went (#255), so #248 took it off the contract.
 */

import type { ContestRepository } from '@poolmaster/shared/db';
import type { Contest } from '@poolmaster/shared/domain';
import { ContestStatus } from '@poolmaster/shared/domain';

export class OverrideService {
  constructor(private readonly contestRepo: ContestRepository) {}

  // --- Contest Lifecycle Overrides (08-023) ---

  /** Re-opens a completed contest. */
  async reopenContest(contestId: string): Promise<Contest> {
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

  /**
   * Force-closes a contest. A draft is refused: "Open to league" and delete are its only exits
   * (#117), and closing one would publish it to members as finished without the open checks.
   */
  async closeContest(contestId: string): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new OverrideError('Contest not found', 'CONTEST_NOT_FOUND');
    }
    if (contest.status === ContestStatus.DRAFT) {
      throw new OverrideError(
        'A draft contest cannot be closed; open it to the league or delete it.',
        'CONTEST_CLOSE_STATUS_INVALID',
        409,
      );
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
  ): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId);
    if (!contest) {
      throw new OverrideError('Contest not found', 'CONTEST_NOT_FOUND');
    }
    return this.contestRepo.update(contestId, { endsAt: newEnd } as Partial<Contest>);
  }
}

export class OverrideError extends Error {
  code: string;
  /** Omitted: 404 for a `*_NOT_FOUND` code, else 400. */
  statusCode?: number;

  constructor(reason: string, code = 'CONTEST_OVERRIDE_INVALID', statusCode?: number) {
    super(reason);
    this.name = 'OverrideError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

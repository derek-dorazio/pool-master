/**
 * OverrideService — commissioner safety-valve tools for in-season contest management.
 *
 * Covers draft overrides, scoring overrides, contest lifecycle overrides,
 * and payout confirmation/override.
 */

import type {
  ContestRepository,
  ContestEntryRepository,
  DraftSessionRepository,
} from '@poolmaster/shared/db';
import type { Contest, DraftSession } from '@poolmaster/shared/domain';
import { ContestStatus, DraftStatus } from '@poolmaster/shared/domain';
import type { ContestScoringRecalculationService } from '../contest-scoring';

export interface RecalculationResult {
  contestId: string;
  teamsAffected: number;
  standingsChanged: boolean;
  changes: StandingsChange[];
}

export interface StandingsChange {
  entryId: string;
  oldRank: number;
  newRank: number;
  oldScore: number;
  newScore: number;
}

const UNDO_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export class OverrideService {
  constructor(
    private readonly contestRepo: ContestRepository,
    private readonly draftSessionRepo: DraftSessionRepository,
    private readonly entryRepo: ContestEntryRepository,
    private readonly contestScoringRecalculationService: ContestScoringRecalculationService,
  ) {}

  // --- Draft Overrides (08-018, 08-019, 08-020) ---

  /** Undoes a draft pick within the configurable window (default 5 min). */
  async undoPick(contestId: string, pickId: string, _reason: string): Promise<void> {
    const session = await this.requireDraftSession(contestId);
    const picks = await this.draftSessionRepo.getPicks(session.id);
    const pick = picks.find((p) => p.id === pickId);
    if (!pick) {
      throw new OverrideError('Pick not found in this draft session');
    }
    const elapsed = Date.now() - pick.pickedAt.getTime();
    if (elapsed > UNDO_WINDOW_MS) {
      throw new OverrideError('Undo window has expired (5 minutes)');
    }
    // Reset current pick to the undone pick's position
    await this.draftSessionRepo.update(session.id, {
      currentPickNumber: pick.pickNumber,
    });
  }

  /** Pauses a live draft. */
  async pauseDraft(contestId: string, _reason: string): Promise<void> {
    const session = await this.requireDraftSession(contestId);
    if (session.status !== DraftStatus.LIVE) {
      throw new OverrideError('Draft can only be paused when live');
    }
    await this.draftSessionRepo.update(session.id, {
      status: DraftStatus.PAUSED,
    } as Partial<DraftSession>);
  }

  /** Resumes a paused draft. */
  async resumeDraft(contestId: string): Promise<void> {
    const session = await this.requireDraftSession(contestId);
    if (session.status !== DraftStatus.PAUSED) {
      throw new OverrideError('Draft can only be resumed when paused');
    }
    await this.draftSessionRepo.update(session.id, {
      status: DraftStatus.LIVE,
    } as Partial<DraftSession>);
  }

  /** Extends the pick clock by additional seconds. */
  async extendPickClock(
    contestId: string,
    additionalSeconds: number,
  ): Promise<void> {
    const session = await this.requireDraftSession(contestId);
    if (!session.pickDeadline) {
      throw new OverrideError('No active pick deadline to extend');
    }
    const newDeadline = new Date(session.pickDeadline.getTime() + additionalSeconds * 1000);
    await this.draftSessionRepo.update(session.id, {
      pickDeadline: newDeadline,
    } as Partial<DraftSession>);
  }

  // --- Scoring Overrides (08-021, 08-022) ---

  /** Adjusts a contest entry's total score by a delta amount. */
  async adjustScore(
    contestId: string,
    entryId: string,
    adjustment: number,
    _reason: string,
  ): Promise<void> {
    const entry = await this.entryRepo.findById(entryId);
    if (!entry || entry.contestId !== contestId) {
      throw new OverrideError('Entry not found in this contest');
    }
    await this.entryRepo.update(entryId, {
      totalScore: entry.totalScore + adjustment,
    });
  }

  /** Forces a recalculation of standings based on current entry scores. */
  async recalculateStandings(contestId: string, tenantId: string): Promise<RecalculationResult> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new OverrideError('Contest not found');
    }
    return this.contestScoringRecalculationService.recalculateContest(contestId);
  }

  // --- Contest Lifecycle Overrides (08-023) ---

  /** Re-opens a completed contest. */
  async reopenContest(contestId: string, tenantId: string, _reason: string): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new OverrideError('Contest not found');
    }
    if (contest.status !== ContestStatus.COMPLETED) {
      throw new OverrideError('Only completed contests can be reopened');
    }
    return this.contestRepo.update(contestId, { status: ContestStatus.ACTIVE } as Partial<Contest>);
  }

  /** Force-closes a contest. */
  async closeContest(contestId: string, tenantId: string, _reason: string): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new OverrideError('Contest not found');
    }
    if (contest.status === ContestStatus.COMPLETED || contest.status === ContestStatus.CANCELLED) {
      throw new OverrideError('Contest is already closed');
    }
    return this.contestRepo.update(contestId, {
      status: ContestStatus.COMPLETED,
    } as Partial<Contest>);
  }

  /** Extends the contest end date. */
  async extendDeadline(
    contestId: string,
    tenantId: string,
    newEnd: Date,
    _reason: string,
  ): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new OverrideError('Contest not found');
    }
    return this.contestRepo.update(contestId, { endsAt: newEnd } as Partial<Contest>);
  }

  /** Updates the lock time for a contest. */
  async updateLockTime(
    contestId: string,
    tenantId: string,
    newLock: Date,
    _reason: string,
  ): Promise<Contest> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new OverrideError('Contest not found');
    }
    return this.contestRepo.update(contestId, { lockAt: newLock } as Partial<Contest>);
  }

  // --- Payout Overrides (08-024) ---

  /** Confirms payouts for a completed contest. */
  async confirmPayouts(contestId: string, tenantId: string): Promise<void> {
    const contest = await this.contestRepo.findById(contestId, tenantId);
    if (!contest) {
      throw new OverrideError('Contest not found');
    }
    if (contest.status !== ContestStatus.COMPLETED) {
      throw new OverrideError('Payouts can only be confirmed for completed contests');
    }
    // Mark payouts confirmed in contest settings
    const settings = (contest.scoringRules as Record<string, unknown>) ?? {};
    await this.contestRepo.update(contestId, {
      scoringRules: { ...settings, payoutsConfirmed: true },
    } as Partial<Contest>);
  }

  // --- Helpers ---

  private async requireDraftSession(contestId: string): Promise<DraftSession> {
    const session = await this.draftSessionRepo.findByContest(contestId);
    if (!session) {
      throw new OverrideError('No draft session found for this contest');
    }
    return session;
  }
}

export class OverrideError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'OverrideError';
  }
}

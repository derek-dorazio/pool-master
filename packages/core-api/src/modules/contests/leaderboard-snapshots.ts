/**
 * Live leaderboards computed once per score write (#1435). Each contest's board is stored as a
 * snapshot, one per contest and shown event, and every viewer's poll reads that row instead of
 * computing the board from every entry, pick and field row.
 *
 * A write that changes what boards are computed from (an admin's score entry, an event write, a
 * provider sync, live scores, a settlement) tells `LeaderboardRebuilds`, which queues a
 * REBUILD_LEADERBOARDS job for each event or contest touched (#1463). One job waits per subject,
 * so a sync writing hundreds of scores to an event costs one rebuild while it waits, and one more
 * for the writes made while that rebuild runs.
 *
 * The rebuild runs wherever the job runner does (the worker, when tasks are split); the snapshot
 * it stores is read by every task, so a viewer anywhere sees it on their next poll. A read also
 * computes the board itself when the stored one is not current (`isSnapshotCurrent`), which
 * covers the changes no write signals.
 */
import type { ContestLeaderboardSnapshot } from '@poolmaster/shared/db';
import { SelectionType, type Contest, type SportEvent, type SportEventMatch } from '@poolmaster/shared/domain';
import { readMillisecondsSetting } from '../../core/read-cache';
import type { BackgroundJobQueue, JobsForWrite } from '../background-jobs/background-job-queue';
import { LeaderboardRebuildSubject, rebuildLeaderboardsJob } from './leaderboard-rebuild-job-requests';

/** Which leaderboard a stored board is: each contest has one, by how its entries pick. */
export const LeaderboardKind = {
  /** A lineup of participants, scored by their results: golf, racing, knockout, stat pools. */
  ROSTER: 'ROSTER',
  BRACKET: 'BRACKET',
  PICK_EM: 'PICK_EM',
  SURVIVOR: 'SURVIVOR',
} as const;
export type LeaderboardKind = (typeof LeaderboardKind)[keyof typeof LeaderboardKind];

/** The contest's leaderboard; none for squares, whose grid is its board. */
export function leaderboardKindOf(contest: Pick<Contest, 'selectionType'>): LeaderboardKind | null {
  switch (contest.selectionType) {
    case SelectionType.TIERED:
    case SelectionType.BUDGET_PICK:
    case SelectionType.RANDOM_DRAW:
      return LeaderboardKind.ROSTER;
    case SelectionType.BRACKET:
      return LeaderboardKind.BRACKET;
    case SelectionType.PICK_EM:
      return LeaderboardKind.PICK_EM;
    case SelectionType.SURVIVOR:
      return LeaderboardKind.SURVIVOR;
    case SelectionType.SQUARES:
      return null;
  }
}

/**
 * The first moment after `now` that one of the contest's events or games is due to start: when a
 * bracket, pick'em or survivor board may reveal picks it does not show yet, and must be computed
 * again. Null when nothing is still to start.
 */
export function nextKickoffAfter(
  now: Date,
  events: readonly Pick<SportEvent, 'startDate'>[],
  games: readonly Pick<SportEventMatch, 'scheduledDate'>[],
): Date | null {
  const starts = [...events.map((event) => event.startDate), ...games.flatMap((game) => (game.scheduledDate ? [game.scheduledDate] : []))];
  return starts.reduce<Date | null>((soonest, start) => (start > now && (soonest === null || start < soonest) ? start : soonest), null);
}

/** The key of the board a read naming no event gets: the latest event whose picks are revealed. */
export const DEFAULT_SHOWN_EVENT = '';

/**
 * How old a stored board may be before a read computes it again: the bound on the changes no
 * write signals, such as a participant's or a squad's new name.
 */
export const LEADERBOARD_SNAPSHOT_MAX_AGE_MS = 300_000;

/** The max age from `LEADERBOARD_SNAPSHOT_MAX_AGE_MS`, in milliseconds, else 5 minutes. */
export function readLeaderboardSnapshotMaxAgeMs(env: NodeJS.ProcessEnv): number {
  return readMillisecondsSetting(env, 'LEADERBOARD_SNAPSHOT_MAX_AGE_MS', LEADERBOARD_SNAPSHOT_MAX_AGE_MS);
}

/**
 * Whether a stored board still answers a read at `now`: it is younger than `maxAgeMs`, no event
 * it does not show has started since, and the contest has not changed since (its status, its
 * name, its draw).
 */
export function isSnapshotCurrent(
  snapshot: Pick<ContestLeaderboardSnapshot<unknown>, 'computedFrom' | 'validUntil' | 'contestUpdatedAt'>,
  contest: Pick<Contest, 'updatedAt'>,
  now: Date,
  maxAgeMs: number,
): boolean {
  return now.getTime() - snapshot.computedFrom.getTime() < maxAgeMs
    && (snapshot.validUntil === null || now < snapshot.validUntil)
    && snapshot.contestUpdatedAt.getTime() === contest.updatedAt.getTime();
}

/** What `rebuildLeaderboardSnapshots` is told changed. */
export interface LeaderboardChanges {
  sportEventIds: readonly string[];
  contestIds: readonly string[];
}

/** What a write tells when it changed what leaderboards are computed from. */
export interface LeaderboardRebuilds {
  /** The fields or statuses of these events changed: their contests' boards are rebuilt soon. */
  eventsChanged(sportEventIds: readonly string[]): Promise<void>;
  /**
   * The job rebuilding the event's contests' boards, for the write changing its scores, field or
   * status to carry into its own transaction (#1466): a write that fails queues no rebuild, and a
   * failed insert fails the write rather than leaving it saved with an error answered.
   */
  forEvent(sportEventId: string): JobsForWrite;
  /** The job rebuilding one contest's boards, for a write that changes only that contest (#1466). */
  forContest(contestId: string): JobsForWrite;
}

/** Queues a rebuild job per event or contest a write changed, each one waiting at most once. */
export class JobLeaderboardRebuilds implements LeaderboardRebuilds {
  constructor(private readonly jobs: Pick<BackgroundJobQueue, 'request' | 'enqueueAll' | 'queued'>) {}

  eventsChanged(sportEventIds: readonly string[]): Promise<void> {
    return this.queue(LeaderboardRebuildSubject.EVENT, sportEventIds);
  }

  forEvent(sportEventId: string): JobsForWrite {
    return this.forWrite(LeaderboardRebuildSubject.EVENT, sportEventId);
  }

  forContest(contestId: string): JobsForWrite {
    return this.forWrite(LeaderboardRebuildSubject.CONTEST, contestId);
  }

  private forWrite(subject: LeaderboardRebuildSubject, id: string): JobsForWrite {
    return { jobs: [rebuildLeaderboardsJob(this.jobs, subject, id)], queued: () => this.jobs.queued() };
  }

  private async queue(subject: LeaderboardRebuildSubject, ids: readonly string[]): Promise<void> {
    await this.jobs.enqueueAll([...new Set(ids)].map((id) => rebuildLeaderboardsJob(this.jobs, subject, id)));
  }
}

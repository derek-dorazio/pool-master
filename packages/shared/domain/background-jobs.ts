import { BackgroundJobKind, BackgroundJobType, type BackgroundJobStatus } from './enums';

/**
 * One background job (#1439): durable work a request handed off, run by whichever server task
 * claims it. Its payload is checked against its type's schema when it is queued and again when
 * it runs.
 */
export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  /** The job's input, as stored: JSON its type's schema reads. */
  payload: unknown;
  status: BackgroundJobStatus;
  /** When it is due: first queued, or retried after a failed try. */
  runAt: Date;
  /** Tries so far, counting the one in progress. */
  attempts: number;
  /** While RUNNING, until when the claiming task holds it; past this it is due again. */
  leaseUntil?: Date;
  /** The error of the last failed try. */
  lastError?: string;
  /**
   * The job's scope (#1819), from its payload: the sport league of a job on a whole league, the
   * event of a job on one event. A job on an event names no league; its league is its event's.
   */
  sportLeagueId?: string;
  sportEventId?: string;
  /** What a SUCCEEDED job's handler reported it did (#1819). */
  result?: BackgroundJobResult;
  createdAt: Date;
  /** When it SUCCEEDED or FAILED. */
  completedAt?: Date;
}

/** What a job's handler may report it did, kept on the job and shown on Activity (#1819). JSON. */
export type BackgroundJobResult = Record<string, unknown>;

/** The sport league or event a job is about (#1819); a job about neither has neither. */
export interface BackgroundJobScope {
  sportLeagueId?: string;
  sportEventId?: string;
}

/**
 * A job to queue, its payload already checked against its type's schema. A `dedupeKey` a job
 * waiting for its first try holds queues nothing: one such job per subject. The key is released
 * for good when the job is claimed, so a request made while it runs, or while it waits to be
 * retried, queues a fresh one.
 */
export interface BackgroundJobRequest extends BackgroundJobScope {
  type: BackgroundJobType;
  payload: unknown;
  /** Due at once when omitted. */
  runAt?: Date;
  dedupeKey?: string;
}

/**
 * Each job type's Activity kind (#1819). Exhaustive over the type, so a new type without a kind
 * fails typecheck.
 */
export const BACKGROUND_JOB_KINDS = {
  [BackgroundJobType.MANUAL_EVENT_SYNC]: BackgroundJobKind.SYNC,
  [BackgroundJobType.PROVIDER_EVENT_SYNC]: BackgroundJobKind.SYNC,
  [BackgroundJobType.SYNC_LEAGUE_EVENTS]: BackgroundJobKind.SYNC,
  [BackgroundJobType.CONTEST_STARTED_EMAILS]: BackgroundJobKind.EMAIL,
  [BackgroundJobType.CONTEST_SETTLED_EMAILS]: BackgroundJobKind.EMAIL,
  [BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS]: BackgroundJobKind.EMAIL,
  [BackgroundJobType.CONTEST_REOPENED_EMAILS]: BackgroundJobKind.EMAIL,
  [BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS]: BackgroundJobKind.SETTLEMENT,
  [BackgroundJobType.SETTLE_GAME_CONTESTS]: BackgroundJobKind.SETTLEMENT,
  [BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST]: BackgroundJobKind.RELEASE,
  [BackgroundJobType.RELEASE_SPORT_EVENT]: BackgroundJobKind.RELEASE,
  [BackgroundJobType.REBUILD_LEADERBOARDS]: BackgroundJobKind.OTHER,
} as const satisfies Record<BackgroundJobType, BackgroundJobKind>;

/** The job types of one Activity kind. */
export function backgroundJobTypesOfKind(kind: BackgroundJobKind): BackgroundJobType[] {
  return (Object.keys(BACKGROUND_JOB_KINDS) as BackgroundJobType[]).filter((type) => BACKGROUND_JOB_KINDS[type] === kind);
}

/**
 * What Activity asks for (#1819): every filter narrows, and a creation window bounds the read.
 * Nothing pages it; the grid holds thousands of rows.
 */
export interface BackgroundJobActivityFilter {
  types?: readonly BackgroundJobType[];
  status?: BackgroundJobStatus;
  /** The league's own jobs and the jobs on any of its events. */
  sportLeagueId?: string;
  sportEventId?: string;
  createdFrom: Date;
  createdTo: Date;
}

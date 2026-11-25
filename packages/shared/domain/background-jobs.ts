import { BackgroundJobKind, BackgroundJobType, type BackgroundJobStatus, type JobErrorType, type JobTrigger, type PersonJobTrigger } from './enums';

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
  /** What started it (#1861). */
  trigger: JobTrigger;
  /** The person whose request queued it: set only for ADMIN and COMMISSIONER, while their account exists. */
  startedBy?: BackgroundJobStarter;
  /** When its latest try started (#1861); unset until it is first claimed. */
  startedAt?: Date;
  /**
   * How many rows a SUCCEEDED job created or changed (#1861): events, field participants,
   * contests settled, boards rebuilt, emails queued. Unset until it succeeds.
   */
  changedCount?: number;
  /**
   * Why it did not do its work (#1861): set with `lastError` on a failed try, and on a job that
   * finished but was held back, such as a release whose checks failed.
   */
  errorType?: JobErrorType;
  createdAt: Date;
  /** When it SUCCEEDED or FAILED. */
  completedAt?: Date;
}

/** Who started a job from a request (#1861), named as screens name a person. */
export interface BackgroundJobStarter {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
}

/**
 * What started a job (#1861): every job queued records one. ADMIN and COMMISSIONER name the
 * signed-in person whose request queued it; the others name no one.
 */
export type JobStart =
  | { trigger: Exclude<JobTrigger, PersonJobTrigger> }
  | { trigger: PersonJobTrigger; startedByUserId: string };

/**
 * What a job's handler reports (#1861): how many rows it created or changed, a reason it was
 * held back when it finished without doing its work, and anything else to keep as its result.
 */
export interface BackgroundJobOutcome {
  changedCount: number;
  heldBack?: JobErrorType;
  result?: BackgroundJobResult;
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
  /** The Provider row a sync job reads (#2040); omitted for a job that calls no provider. */
  providerId?: string;
  payload: unknown;
  /** Due at once when omitted. */
  runAt?: Date;
  dedupeKey?: string;
  /** What started it (#1861). */
  start: JobStart;
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
  [BackgroundJobType.RELEASE_SPORT_EVENT]: BackgroundJobKind.RELEASE,
  [BackgroundJobType.REBUILD_LEADERBOARDS]: BackgroundJobKind.OTHER,
  [BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS]: BackgroundJobKind.SYNC,
  [BackgroundJobType.ACTIVATE_EVENT_CONTESTS]: BackgroundJobKind.OTHER,
  [BackgroundJobType.FOLLOW_POSTPONED_EVENT_CONTESTS]: BackgroundJobKind.OTHER,
  [BackgroundJobType.RESOLVE_MAPPED_PARTICIPANT_FINDINGS]: BackgroundJobKind.SYNC,
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

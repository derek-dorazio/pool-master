/**
 * The root admin's League page (#1865): one sport league's syncs, events and participants, each
 * read whole and never paged.
 */
import type {
  ParticipantAddedBy,
  ParticipantType,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  SportEventReleaseAtKind,
  SportEventReleaseMode,
  SportEventStatus,
  SportLeagueSyncHealth,
  SportLeagueSyncMode,
} from './enums';
import type { AutoReleaseCheck, SportLeagueIssue } from './sport-league-overview';
import type { FieldOrderBasis } from './field-ordering';

/** A sync's latest run, as the Syncs card shows it. */
export interface SportLeagueSyncLastRun {
  id: string;
  status: ProviderSyncRunStatus;
  /** When it was queued. */
  createdAt: Date;
  /** When it started; null while it waits. */
  startedAt: Date | null;
  /** Its outcome summary as the sync history shows it; null when it has none. */
  summary: string | null;
  /** Rows it created or updated; null when it failed, has not finished, or counted none. */
  changedCount: number | null;
}

/** One of a sport league's syncs: event list, fields, or live scores and results. */
export interface SportLeagueSync {
  kind: ProviderSyncKind;
  health: SportLeagueSyncHealth;
  mode: SportLeagueSyncMode;
  lastRun: SportLeagueSyncLastRun | null;
  /** When the schedule runs it next; null when nothing will: it is off, its policy is off, or the webhook drives it. */
  nextRunAt: Date | null;
}

/** One event on the League page's Events grid. */
export interface SportLeagueEventOverview {
  id: string;
  name: string;
  eventYear: number;
  startDate: Date;
  endDate: Date | null;
  status: SportEventStatus;
  releaseMode: SportEventReleaseMode;
  /** With its kind: when it was released, or for an automatic draft when its window opens. Null otherwise. */
  releaseAt: Date | null;
  releaseAtKind: SportEventReleaseAtKind | null;
  lastReleaseCheck: AutoReleaseCheck | null;
  /** Its field's size; null until a field loads. */
  fieldSize: number | null;
  issues: SportLeagueIssue[];
  /** When a sync last ran on it; null before any. */
  lastSyncedAt: Date | null;
}

/** One participant on the League page's Participants grid. */
export interface SportLeagueParticipantOverview {
  id: string;
  name: string;
  participantType: ParticipantType;
  shortName: string | null;
  nationality: string | null;
  teamAffiliation: string | null;
  role: string | null;
  ranking: number | null;
  /** Its provider's id for it; null when it has no provider mapping. */
  feedId: string | null;
  /** When a sync last saw it in the feed; null when none has. */
  lastInFeedAt: Date | null;
  addedBy: ParticipantAddedBy;
  createdAt: Date;
}

/** One field row's place in its provider's feed (#1889): the Event page's Last in feed column. */
export interface SportEventFieldFeedRow {
  sportEventParticipantId: string;
  /** Its participant's provider id in the event's sport league; null when it has no provider mapping. */
  feedId: string | null;
  /** When a sync last saw its participant in the feed; null when none has. */
  lastInFeedAt: Date | null;
}

/**
 * The root admin's Event page header and sync rows (#1889), by the League page's rules applied
 * to one event: its field and scores syncs, their health, its issues, its release and the value
 * its field is ordered by.
 */
export interface SportEventOverview {
  syncHealth: SportLeagueSyncHealth;
  /** Its FIELD and SCORES syncs, in kind order. */
  syncs: SportLeagueSync[];
  issues: SportLeagueIssue[];
  releaseMode: SportEventReleaseMode;
  releaseAt: Date | null;
  releaseAtKind: SportEventReleaseAtKind | null;
  /** The value that orders its active field for tiers and prices; null while it has no active field. */
  tierOrderBasis: FieldOrderBasis | null;
  /** False when no value covers the whole active field, so `tierOrderBasis` is the first value anyone has. */
  tierOrderCoversField: boolean;
  /** One per field row, active or withdrawn. */
  fieldFeed: SportEventFieldFeedRow[];
  /** The slug of the event page (`/play/<sport>/<slug>`) offering its series; null when none does. */
  eventPageSlug: string | null;
}

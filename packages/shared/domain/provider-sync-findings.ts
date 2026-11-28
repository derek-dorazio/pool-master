/**
 * Sync findings (#1999, league model 2): one list of the problems the sync found, each with its
 * severity, its status and what an admin can do about it. A finding always names its sport
 * league; its event, Provider and the provider's own value are there when its kind has them.
 */
import type { BackgroundJobStarter } from './background-jobs';
import {
  ProviderSyncFindingAction,
  ProviderSyncFindingKind,
  ProviderSyncFindingStatus,
  type ProviderSyncFindingSeverity,
  type ProviderSyncKind,
  type Sport,
} from './enums';

/** What a finding is about: one row per kind and subject. */
export interface ProviderSyncFindingSubject {
  kind: ProviderSyncFindingKind;
  sportLeagueId: string;
  sportEventId: string | null;
  /** The Provider row (`providers.id`). */
  providerId: string | null;
  /** What the feed sent that nothing maps, such as a participant id. */
  providerValue: string | null;
  /** The sync a SYNC_FAILED finding is about (#2092); no other kind has one, so it is left out. */
  syncKind?: ProviderSyncKind | null;
}

/** The sync raising a finding: its subject, how serious it is, and the feed's name for the value. */
export interface ProviderSyncFindingRaise extends ProviderSyncFindingSubject {
  severity: ProviderSyncFindingSeverity;
  providerValueName: string | null;
  /** The run that raised it, kept as the latest (a SYNC_FAILED finding's failed run). */
  syncRunId?: string | null;
}

/** A finding the sync's raise opened: new, or resolved before and seen again. */
export interface ProviderSyncFindingOpened {
  id: string;
  kind: ProviderSyncFindingKind;
  severity: ProviderSyncFindingSeverity;
  sportLeagueId: string;
}

/** The root admin who last set a finding's status, named as screens name a person. */
export type ProviderSyncFindingChanger = BackgroundJobStarter;

export interface ProviderSyncFinding {
  id: string;
  kind: ProviderSyncFindingKind;
  severity: ProviderSyncFindingSeverity;
  status: ProviderSyncFindingStatus;
  sportLeague: { id: string; name: string; sport: Sport };
  sportEvent: { id: string; name: string } | null;
  provider: { id: string; name: string } | null;
  providerValue: string | null;
  providerValueName: string | null;
  /** The sync a SYNC_FAILED finding is about; null for every other kind. */
  syncKind: ProviderSyncKind | null;
  waiveNote: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** How many sync passes have raised it. */
  seenCount: number;
  statusChangedAt: Date;
  /** Null when the sync set its status, or the admin's account is gone. */
  statusChangedBy: ProviderSyncFindingChanger | null;
}

/** A root admin's status change: WAIVED needs a note; the others clear it. */
export interface ProviderSyncFindingStatusChange {
  status: ProviderSyncFindingStatus;
  waiveNote: string | null;
  changedByUserId: string;
  changedAt: Date;
}

/** Each kind's own fix, offered while a finding of it is OPEN; a new kind names its own here. */
const KIND_ACTIONS: Readonly<Record<ProviderSyncFindingKind, readonly ProviderSyncFindingAction[]>> = {
  [ProviderSyncFindingKind.UNMAPPED_PARTICIPANT]: [ProviderSyncFindingAction.MAP_PARTICIPANT],
  [ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING]: [],
  [ProviderSyncFindingKind.SEASON_MISSING]: [],
  [ProviderSyncFindingKind.PROVIDER_RATE_LIMITED]: [],
  [ProviderSyncFindingKind.NO_PROVIDER_PARTICIPANTS]: [],
  [ProviderSyncFindingKind.NO_PROVIDER_LIVE_SCORES]: [],
  [ProviderSyncFindingKind.GAMES_NOT_SYNCED]: [],
  [ProviderSyncFindingKind.SLOT_VALUE_UNMAPPED]: [],
  [ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN]: [],
  [ProviderSyncFindingKind.SLOT_NAME_UNMATCHED]: [ProviderSyncFindingAction.LINK_SLOT],
  [ProviderSyncFindingKind.SLOT_NAME_AMBIGUOUS]: [],
  [ProviderSyncFindingKind.SLOT_SEASON_COMPETITION_MISSING]: [],
  [ProviderSyncFindingKind.SLOT_OUTSIDE_SEASON]: [],
  [ProviderSyncFindingKind.GAMES_UNPLACED]: [],
  [ProviderSyncFindingKind.SLOT_DATES_NEEDED]: [],
  [ProviderSyncFindingKind.FIELD_HAS_NO_ORDER]: [],
  [ProviderSyncFindingKind.GAME_UNKNOWN]: [],
  [ProviderSyncFindingKind.GAME_ID_REISSUED]: [],
  [ProviderSyncFindingKind.GAME_MOVED]: [],
  [ProviderSyncFindingKind.TIEBREAKER_GAME_REPLACED]: [],
  [ProviderSyncFindingKind.FIELD_TEAM_WITHOUT_GAME]: [],
  [ProviderSyncFindingKind.SYNC_FAILED]: [],
  [ProviderSyncFindingKind.CONFERENCE_UNMAPPED]: [],
  [ProviderSyncFindingKind.DIVISION_UNMAPPED]: [],
  [ProviderSyncFindingKind.CONFERENCE_TEAMS_MISSING]: [],
};

/**
 * What an admin can do with a finding, in the dialog's order: an OPEN one can be fixed by its
 * kind's own action (an unmapped participant is mapped), resolved or waived; a resolved or
 * waived one can be opened again. The API sends these; the web app only draws them.
 */
export function providerSyncFindingActions(finding: Pick<ProviderSyncFinding, 'kind' | 'status'>): ProviderSyncFindingAction[] {
  if (finding.status !== ProviderSyncFindingStatus.OPEN) return [ProviderSyncFindingAction.REOPEN];
  return [...KIND_ACTIONS[finding.kind], ProviderSyncFindingAction.RESOLVE, ProviderSyncFindingAction.WAIVE];
}

/** The status actions a root admin takes on a finding's status route, and the status each sets. */
export const PROVIDER_SYNC_FINDING_STATUS_ACTIONS = {
  [ProviderSyncFindingAction.RESOLVE]: ProviderSyncFindingStatus.RESOLVED,
  [ProviderSyncFindingAction.WAIVE]: ProviderSyncFindingStatus.WAIVED,
  [ProviderSyncFindingAction.REOPEN]: ProviderSyncFindingStatus.OPEN,
} as const satisfies Partial<Record<ProviderSyncFindingAction, ProviderSyncFindingStatus>>;
export type ProviderSyncFindingStatusAction = keyof typeof PROVIDER_SYNC_FINDING_STATUS_ACTIONS;

/** How long a RESOLVED finding is kept after it was resolved. OPEN and WAIVED ones are kept for good. */
export const RESOLVED_SYNC_FINDING_RETENTION_DAYS = 90;

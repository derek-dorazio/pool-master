/**
 * The root admin's Sports page (#1847): one row per sport league with what is healthy, what needs
 * attention and when it plays. Read whole, never paged.
 */
import type {
  AutoReleaseCheckOutcome,
  ProviderSyncFindingSeverity,
  ProviderSyncKind,
  Sport,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueSyncHealth,
} from './enums';
import type { ReleaseCheckKey } from './release-checks';

/**
 * A sport event's latest automatic release check (#1847): when the release job judged it, whether
 * it released or held it, and the checks that held it (empty when released).
 */
export interface AutoReleaseCheck {
  checkedAt: Date;
  outcome: AutoReleaseCheckOutcome;
  failedChecks: ReleaseCheckKey[];
}

/** What an issue item opens. */
export interface SportLeagueIssueTarget {
  type: SportLeagueIssueTargetType;
  id: string;
}

/** What every issue item carries: a name to show, when it happened and what to open. */
interface SportLeagueIssueItemBase {
  label: string;
  occurredAt: Date;
  target: SportLeagueIssueTarget;
}

/** A sync whose latest finished run failed: the run's own summary, when it failed, and the run. */
export interface SportLeagueSyncIssueItem extends SportLeagueIssueItemBase {
  syncKind: ProviderSyncKind;
}

/** A draft event its latest automatic release check held: its name, when it was checked, the checks that failed. */
export interface SportLeagueReleaseIssueItem extends SportLeagueIssueItemBase {
  failedChecks: ReleaseCheckKey[];
}

/**
 * An event whose results are overdue (#1865): its name, and when it should have ended, from which
 * a screen says how late it is.
 */
export type SportLeagueOverdueIssueItem = SportLeagueIssueItemBase;

/** How many OPEN sync findings of one severity the league has (#1999); the Findings list shows them. */
export interface SportLeagueFindingsIssueItem {
  severity: ProviderSyncFindingSeverity;
  count: number;
}

export type SportLeagueIssue =
  | { type: typeof SportLeagueIssueType.FINDINGS; count: number; items: SportLeagueFindingsIssueItem[] }
  | { type: typeof SportLeagueIssueType.SYNC; count: number; items: SportLeagueSyncIssueItem[] }
  | { type: typeof SportLeagueIssueType.RELEASE; count: number; items: SportLeagueReleaseIssueItem[] }
  | { type: typeof SportLeagueIssueType.OVERDUE; count: number; items: SportLeagueOverdueIssueItem[] };

/** The first to last day of a season's events. */
export interface SeasonSpan {
  start: Date;
  end: Date;
}

export interface SportLeagueOverview {
  id: string;
  sport: Sport;
  /** Its sport's URL segment (#2042): a link to the league's Manage page names the sport by it. */
  sportUrlSegment: string;
  /** Its sport's display order (#2042): the Sports grid sorts its sport column by it. */
  sportDisplayOrder: number;
  name: string;
  /** The provider that syncs its events. Null when none does. */
  providerId: string | null;
  isActive: boolean;
  syncHealth: SportLeagueSyncHealth;
  /** Only the types with something to do, in their fixed order. */
  issues: SportLeagueIssue[];
  season: SeasonSpan | null;
  nextEventStartsAt: Date | null;
  eventCount: number;
}

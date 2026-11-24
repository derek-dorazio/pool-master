import type {
  ProviderSyncFinding,
  ProviderSyncFindingKind,
  ProviderSyncFindingOpened,
  ProviderSyncFindingRaise,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatusChange,
} from '../domain';

/** The OPEN findings of one kind to resolve: every part given narrows it. */
export interface ProviderSyncFindingResolveFilter {
  kind: ProviderSyncFindingKind;
  sportLeagueId?: string;
  providerId?: string;
  providerValue?: string;
}

/** A sport league's OPEN findings of one severity, for the Sports page. */
export interface ProviderSyncFindingOpenCount {
  sportLeagueId: string;
  severity: ProviderSyncFindingSeverity;
  count: number;
}

/** The sync findings table (#1999): one row per kind and subject. */
export interface ProviderSyncFindingRepository {
  /**
   * Raises each finding in a fixed number of statements, however many: a new subject gets a row,
   * OPEN; one seen before takes the new severity and name and counts the sighting. A RESOLVED one
   * opens again; a WAIVED one stays waived. Returns the findings that are newly OPEN.
   */
  raise(raises: readonly ProviderSyncFindingRaise[], seenAt: Date): Promise<ProviderSyncFindingOpened[]>;
  /** Resolves the OPEN findings the filter names, as the sync; returns how many. */
  resolveOpen(filter: ProviderSyncFindingResolveFilter, resolvedAt: Date): Promise<number>;
  /** Every finding kept, with its league, event, Provider and changer, most recently seen first. */
  findAll(): Promise<ProviderSyncFinding[]>;
  findById(id: string): Promise<ProviderSyncFinding | null>;
  /** Sets one finding's status as a root admin; null when there is no such finding. */
  setStatus(id: string, change: ProviderSyncFindingStatusChange): Promise<ProviderSyncFinding | null>;
  /** Deletes up to `limit` findings RESOLVED before `before`; never an OPEN or WAIVED one. */
  deleteResolvedBatchBefore(before: Date, limit: number): Promise<number>;
}

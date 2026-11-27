/**
 * The root admin's sport league overview (#1847): one row per sport league for the Sports page,
 * with its sync health, what needs attention, its current Season's span (#2003) and its next event. The reader gathers
 * every league's facts in a fixed number of grouped reads; everything here is computed from them.
 */
import type {
  ProviderSyncFindingOpenCount,
  SportLeagueFailedSync,
  SportLeagueOverdueCandidate,
  SportLeagueOverviewFacts,
  SportLeagueOverviewReader,
} from '@poolmaster/shared/db';
import {
  compareByEnumOrder,
  overdueExpectedEnd,
  ProviderSyncFindingSeverityOrder,
  ProviderSyncKindOrder,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueSyncHealth,
  type OverdueEventFacts,
  type ProviderSyncKind,
  type SportLeagueFindingsIssueItem,
  type SportLeagueIssue,
  type SportLeagueOverdueIssueItem,
  type SportLeagueOverview,
  type SportLeagueSyncIssueItem,
} from '@poolmaster/shared/domain';

export class SportLeagueOverviewService {
  constructor(private readonly deps: { reader: SportLeagueOverviewReader; now?: () => Date }) {}

  async listOverviews(): Promise<SportLeagueOverview[]> {
    const now = this.deps.now?.() ?? new Date();
    return buildSportLeagueOverviews(await this.deps.reader.readFacts(now), now);
  }
}

/** Every sport league's overview, by sport (most popular first), then by name. */
export function buildSportLeagueOverviews(facts: SportLeagueOverviewFacts, now: Date): SportLeagueOverview[] {
  const failedByLeague = groupBy(facts.failedSyncs, (sync) => sync.sportLeagueId);
  const heldByLeague = groupBy(facts.heldEvents, (event) => event.sportLeagueId);
  const overdueByLeague = groupBy<SportLeagueOverdueCandidate>(facts.overdueCandidates, (event) => event.sportLeagueId);
  const findingsByLeague = groupBy(facts.openFindings, (count) => count.sportLeagueId);

  const overviews = facts.leagues.map((league): SportLeagueOverview => {
    const providerId = league.syncProviderId;
    const failed = failedByLeague.get(league.id) ?? [];
    return {
      id: league.id,
      sport: league.sport,
      sportUrlSegment: league.sportUrlSegment,
      sportDisplayOrder: league.sportDisplayOrder,
      name: league.name,
      providerId,
      providerName: league.syncProviderName,
      isActive: league.isActive,
      syncHealth: syncHealthOf({
        isActive: league.isActive,
        providerId,
        runCount: facts.leaguesWithSyncRuns.has(league.id) ? 1 : 0,
        failedRunCount: failed.length,
      }),
      issues: [
        ...findingsIssuesOf(findingsByLeague.get(league.id) ?? []),
        ...issuesOf(failedSyncItemsOf(failed), heldByLeague.get(league.id) ?? [], overdueByLeague.get(league.id) ?? [], now),
      ],
      season: facts.currentSeasonSpans.get(league.id) ?? null,
      nextEventStartsAt: facts.nextEventStarts.get(league.id) ?? null,
      eventCount: facts.eventCounts.get(league.id) ?? 0,
    };
  });
  return overviews.sort(compareOverviews);
}

/**
 * OFF while the league is off or no provider syncs it; else ERROR when any of its syncs failed and
 * has not completed since, NOT_RUN_YET before any sync has run, and OK otherwise. A run still under
 * way counts as not failed: it is the sync trying again.
 */
export function syncHealthOf(input: { isActive: boolean; providerId: string | null; runCount: number; failedRunCount: number }): SportLeagueSyncHealth {
  if (!input.isActive || input.providerId === null) return SportLeagueSyncHealth.OFF;
  if (input.failedRunCount > 0) return SportLeagueSyncHealth.ERROR;
  if (input.runCount === 0) return SportLeagueSyncHealth.NOT_RUN_YET;
  return SportLeagueSyncHealth.OK;
}

/**
 * The league's FINDINGS issue (#1999): its OPEN sync findings counted by severity, most serious
 * first. None when it has none. Only the Sports page has it; an event's issues never do.
 */
export function findingsIssuesOf(counts: readonly Pick<ProviderSyncFindingOpenCount, 'severity' | 'count'>[]): SportLeagueIssue[] {
  const items = counts
    .filter((entry) => entry.count > 0)
    .map((entry): SportLeagueFindingsIssueItem => ({ severity: entry.severity, count: entry.count }))
    .sort((left, right) => compareByEnumOrder(ProviderSyncFindingSeverityOrder)(left.severity, right.severity));
  if (items.length === 0) return [];
  return [{ type: SportLeagueIssueType.FINDINGS, count: items.reduce((total, entry) => total + entry.count, 0), items }];
}

/** A failed run's Sync item: the run's own summary, when it failed, the run and its sync. */
export interface FailedSyncRun {
  id: string;
  kind: ProviderSyncKind;
  createdAt: Date;
  summary: string | null;
}

/** The Sync items of an event's failed latest runs (the League and event pages): one per run, by sync kind. */
export function failedRunItemsOf(failedRuns: readonly FailedSyncRun[]): SportLeagueSyncIssueItem[] {
  return [...failedRuns]
    .sort((left, right) => compareByEnumOrder(ProviderSyncKindOrder)(left.kind, right.kind))
    .map(failedRunItem);
}

function failedRunItem(run: FailedSyncRun): SportLeagueSyncIssueItem {
  return {
    label: run.summary ?? run.kind,
    occurredAt: run.createdAt,
    target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: run.id },
    syncKind: run.kind,
  };
}

/**
 * The Sports page's Sync items (#2092): a league's failed syncs whose latest failed run is kept,
 * by sync kind, then most recent first. One whose run is cleared is counted with the Findings.
 */
function failedSyncItemsOf(failedSyncs: readonly Omit<SportLeagueFailedSync, 'sportLeagueId'>[]): SportLeagueSyncIssueItem[] {
  return failedSyncs
    .flatMap((sync) => (sync.run === null ? [] : [{ id: sync.run.id, kind: sync.syncKind, createdAt: sync.lastFailedAt, summary: sync.run.summary }]))
    .sort((left, right) => compareByEnumOrder(ProviderSyncKindOrder)(left.kind, right.kind) || right.createdAt.getTime() - left.createdAt.getTime())
    .map(failedRunItem);
}

/**
 * The issue types with something to do, in their fixed order: SYNC, RELEASE, OVERDUE. The League
 * page's events read gives each event its own, from that event's runs, hold and dates.
 */
export function issuesOf(
  syncItems: readonly SportLeagueSyncIssueItem[],
  heldEvents: readonly Omit<SportLeagueOverviewFacts['heldEvents'][number], 'sportLeagueId'>[],
  overdueCandidates: readonly OverdueEventFacts[],
  now: Date,
): SportLeagueIssue[] {
  const issues: SportLeagueIssue[] = [];
  if (syncItems.length > 0) {
    issues.push({ type: SportLeagueIssueType.SYNC, count: syncItems.length, items: [...syncItems] });
  }
  if (heldEvents.length > 0) {
    const items = [...heldEvents]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((event) => ({
        label: event.name,
        occurredAt: event.checkedAt,
        target: { type: SportLeagueIssueTargetType.SPORT_EVENT, id: event.id },
        failedChecks: event.failedChecks,
      }));
    issues.push({ type: SportLeagueIssueType.RELEASE, count: items.length, items });
  }
  const overdue = overdueItemsOf(overdueCandidates, now);
  if (overdue.length > 0) {
    issues.push({ type: SportLeagueIssueType.OVERDUE, count: overdue.length, items: overdue });
  }
  return issues;
}

/** The overdue events among the candidates (#1865), most overdue first, each with when it should have ended. */
function overdueItemsOf(candidates: readonly OverdueEventFacts[], now: Date): SportLeagueOverdueIssueItem[] {
  return candidates
    .flatMap((event): SportLeagueOverdueIssueItem[] => {
      const expectedEnd = overdueExpectedEnd(event, now);
      return expectedEnd === null ? [] : [{ label: event.name, occurredAt: expectedEnd, target: { type: SportLeagueIssueTargetType.SPORT_EVENT, id: event.id } }];
    })
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.label.localeCompare(right.label));
}

function compareOverviews(left: SportLeagueOverview, right: SportLeagueOverview): number {
  return left.sportDisplayOrder - right.sportDisplayOrder || left.name.localeCompare(right.name);
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group === undefined) groups.set(key(item), [item]);
    else group.push(item);
  }
  return groups;
}

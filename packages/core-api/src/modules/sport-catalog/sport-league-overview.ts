/**
 * The root admin's sport league overview (#1847): one row per sport league for the Sports page,
 * with its sync health, what needs attention, its season and its next event. The reader gathers
 * every league's facts in a fixed number of grouped reads; everything here is computed from them.
 */
import type {
  SportLeagueClutchCardEvent,
  SportLeagueEventYearSpan,
  SportLeagueLatestSyncRun,
  SportLeagueOverviewFacts,
  SportLeagueOverviewLeague,
  SportLeagueOverviewReader,
} from '@poolmaster/shared/db';
import {
  compareByEnumOrder,
  isClutchCardLeague,
  ProviderSyncKind,
  ProviderSyncKindOrder,
  ProviderSyncRunStatus,
  SportLeagueIssueTargetType,
  SportLeagueIssueType,
  SportLeagueKind,
  SportLeagueSyncHealth,
  SportOrder,
  type SeasonSpan,
  type SportLeagueIssue,
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

/**
 * Every sport league's overview, by sport (most popular first), then by name, each Clutch Card
 * straight after its parent league.
 */
export function buildSportLeagueOverviews(facts: SportLeagueOverviewFacts, now: Date): SportLeagueOverview[] {
  const leagueById = new Map(facts.leagues.map((league) => [league.id, league]));
  const runsByLeague = groupBy(facts.latestSyncRuns, (run) => run.sportLeagueId);
  const heldByLeague = groupBy(facts.heldEvents, (event) => event.sportLeagueId);
  const spansByLeague = groupBy(facts.eventYearSpans, (span) => span.sportLeagueId);
  const clutchByLeague = groupBy(facts.clutchCardEvents, (event) => event.sportLeagueId);

  const overviews = facts.leagues.map((league): SportLeagueOverview => {
    const clutchCard = isClutchCardLeague(league);
    const parent = league.parentSportLeagueId === null ? undefined : leagueById.get(league.parentSportLeagueId);
    const providerId = clutchCard ? parent?.eventSyncProviderId ?? null : league.eventSyncProviderId;
    const runs = syncRunsOf(league, clutchCard, runsByLeague);
    const failedRuns = runs.filter((run) => run.status === ProviderSyncRunStatus.FAILED);
    return {
      id: league.id,
      sport: league.sport,
      name: league.name,
      parentSportLeagueId: league.parentSportLeagueId,
      kind: clutchCard ? SportLeagueKind.CLUTCH_CARD : SportLeagueKind.REAL,
      providerId,
      isActive: league.isActive,
      syncHealth: syncHealthOf({ isActive: league.isActive, providerId, runCount: runs.length, failedRunCount: failedRuns.length }),
      issues: issuesOf(failedRuns, heldByLeague.get(league.id) ?? []),
      season: clutchCard
        ? seasonOf(clutchCardSpans(clutchByLeague.get(league.id) ?? []), now)
        : seasonOf((spansByLeague.get(league.id) ?? []).map(yearSpan), now),
      nextEventStartsAt: facts.nextEventStarts.get(league.id) ?? null,
      eventCount: facts.eventCounts.get(league.id) ?? 0,
    };
  });
  return overviews.sort(compareOverviews(leagueById));
}

/**
 * The latest run of each of the league's syncs: its own field and scores runs, and its event list
 * run, a Clutch Card's from its parent league, whose event list sync creates its events.
 */
function syncRunsOf(
  league: SportLeagueOverviewLeague,
  clutchCard: boolean,
  runsByLeague: ReadonlyMap<string, SportLeagueLatestSyncRun[]>,
): SportLeagueLatestSyncRun[] {
  const own = runsByLeague.get(league.id) ?? [];
  if (!clutchCard || league.parentSportLeagueId === null) return own;
  const parentEventsRun = (runsByLeague.get(league.parentSportLeagueId) ?? []).filter((run) => run.kind === ProviderSyncKind.EVENTS);
  return [...own.filter((run) => run.kind !== ProviderSyncKind.EVENTS), ...parentEventsRun];
}

/**
 * OFF while the league is off or no provider syncs it; else ERROR when the latest run of any of
 * its syncs failed, NOT_RUN_YET before any sync has run, and OK otherwise. A run still under way
 * counts as not failed: it is the sync trying again.
 */
export function syncHealthOf(input: { isActive: boolean; providerId: string | null; runCount: number; failedRunCount: number }): SportLeagueSyncHealth {
  if (!input.isActive || input.providerId === null) return SportLeagueSyncHealth.OFF;
  if (input.failedRunCount > 0) return SportLeagueSyncHealth.ERROR;
  if (input.runCount === 0) return SportLeagueSyncHealth.NOT_RUN_YET;
  return SportLeagueSyncHealth.OK;
}

/** The issue types with something to do, in their fixed order: SYNC, RELEASE. */
function issuesOf(
  failedRuns: readonly SportLeagueLatestSyncRun[],
  heldEvents: SportLeagueOverviewFacts['heldEvents'],
): SportLeagueIssue[] {
  const issues: SportLeagueIssue[] = [];
  if (failedRuns.length > 0) {
    const items = [...failedRuns]
      .sort((left, right) => compareByEnumOrder(ProviderSyncKindOrder)(left.kind, right.kind))
      .map((run): SportLeagueSyncIssueItem => ({
        label: run.summary ?? run.kind,
        occurredAt: run.createdAt,
        target: { type: SportLeagueIssueTargetType.SYNC_RUN, id: run.id },
        syncKind: run.kind,
      }));
    issues.push({ type: SportLeagueIssueType.SYNC, count: items.length, items });
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
  return issues;
}

/** One event year's span, from its first start to its last end or start, whichever is later. */
function yearSpan(span: SportLeagueEventYearSpan): SeasonSpan & { eventYear: number } {
  const end = span.lastEnd !== null && span.lastEnd > span.lastStart ? span.lastEnd : span.lastStart;
  return { eventYear: span.eventYear, start: span.firstStart, end };
}

/**
 * A Clutch Card league's seasons (#1820): each event covers rounds of its parent event, so each
 * event year spans the first to the last day of those rounds. An event whose parent has none of
 * them scheduled adds nothing.
 */
function clutchCardSpans(events: readonly SportLeagueClutchCardEvent[]): (SeasonSpan & { eventYear: number })[] {
  const byYear = new Map<number, SeasonSpan>();
  for (const event of events) {
    const covered = event.parentRounds.filter((round) => event.parentRoundNumbers.includes(round.roundNumber));
    for (const round of covered) {
      const end = round.scheduledEndAt !== null && round.scheduledEndAt > round.scheduledDate ? round.scheduledEndAt : round.scheduledDate;
      const known = byYear.get(event.eventYear);
      byYear.set(event.eventYear, known === undefined
        ? { start: round.scheduledDate, end }
        : { start: round.scheduledDate < known.start ? round.scheduledDate : known.start, end: end > known.end ? end : known.end });
    }
  }
  return [...byYear].map(([eventYear, span]) => ({ eventYear, ...span }));
}

/**
 * The season to show: the event year under way now; between seasons the next one to start; with
 * no next one known, the latest that ended. Null when the league has no events yet.
 */
export function seasonOf(spans: readonly (SeasonSpan & { eventYear: number })[], now: Date): SeasonSpan | null {
  const byStart = [...spans].sort((left, right) => left.start.getTime() - right.start.getTime());
  const chosen = byStart.find((span) => span.start <= now && now <= span.end)
    ?? byStart.find((span) => span.start > now)
    ?? [...byStart].sort((left, right) => right.end.getTime() - left.end.getTime()).at(0);
  return chosen === undefined ? null : { start: chosen.start, end: chosen.end };
}

function compareOverviews(leagueById: ReadonlyMap<string, SportLeagueOverviewLeague>) {
  const compareSport = compareByEnumOrder(SportOrder);
  // A Clutch Card sorts under its parent: by the parent's name, after it.
  const parentOf = (overview: SportLeagueOverview) => (overview.kind === SportLeagueKind.CLUTCH_CARD && overview.parentSportLeagueId !== null
    ? leagueById.get(overview.parentSportLeagueId)
    : undefined);
  const familyName = (overview: SportLeagueOverview) => parentOf(overview)?.name ?? overview.name;
  const isChild = (overview: SportLeagueOverview) => (parentOf(overview) === undefined ? 0 : 1);
  return (left: SportLeagueOverview, right: SportLeagueOverview): number => compareSport(left.sport, right.sport)
    || familyName(left).localeCompare(familyName(right))
    || isChild(left) - isChild(right)
    || left.name.localeCompare(right.name);
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

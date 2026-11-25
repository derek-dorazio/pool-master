/**
 * The root admin's League page (#1865): one sport league's syncs, events and participants. The
 * reader gathers each read's facts in a fixed number of grouped queries; everything here is
 * computed from them, with the Sports page's overview rules for health and issues.
 */
import type {
  SportEventPageFacts,
  SportLeagueEventFacts,
  SportLeaguePageEvent,
  SportLeaguePageLeague,
  SportLeaguePageReader,
  SportLeaguePageRun,
} from '@poolmaster/shared/db';
import {
  AutoReleaseCheckOutcome,
  compareByEnumOrder,
  fieldOrderDecision,
  orderSportLeagueSeasons,
  orderSportLeagueStructure,
  ParticipantAddedBy,
  ProviderSyncKind,
  ProviderSyncKindOrder,
  ProviderSyncRunStatus,
  SportEventReleaseAtKind,
  SportEventReleaseMode,
  SportEventStatus,
  SportLeagueSyncMode,
  type SportEventOverview,
  type SportLeagueEventOverview,
  type SportLeagueParticipantOverview,
  type SportLeagueSeasonDetail,
  type SportLeaguePosition,
  type SportLeagueStructure,
  type SportLeagueSync,
} from '@poolmaster/shared/domain';
import { issuesOf, syncHealthOf } from './sport-league-overview';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SportLeaguePageServiceDeps {
  reader: SportLeaguePageReader;
  /**
   * The providers whose webhooks drive their live scores, with a poll only while an event is in
   * play (#1499): their row switched on and their secret set, read now.
   */
  webhookProviderIds: () => readonly string[];
  now?: () => Date;
}

export class SportLeaguePageService {
  constructor(private readonly deps: SportLeaguePageServiceDeps) {}

  /** Null when the league does not exist. */
  async listSyncs(sportLeagueId: string): Promise<SportLeagueSync[] | null> {
    const facts = await this.deps.reader.readSyncFacts(sportLeagueId);
    if (facts === null) return null;
    return buildSportLeagueSyncs(facts.league, facts.latestRuns, { webhookProviderIds: this.deps.webhookProviderIds() });
  }

  /** Null when the league does not exist. */
  async listEvents(sportLeagueId: string): Promise<SportLeagueEventOverview[] | null> {
    const now = this.now();
    const facts = await this.deps.reader.readEventFacts(sportLeagueId, now);
    return facts === null ? null : buildSportLeagueEvents(facts, now);
  }

  /** Null when the league does not exist. */
  async listParticipants(sportLeagueId: string): Promise<SportLeagueParticipantOverview[] | null> {
    const rows = await this.deps.reader.readParticipants(sportLeagueId);
    if (rows === null) return null;
    return rows.map(({ participant, mapping }) => ({
      ...participant,
      feedId: mapping?.externalId ?? null,
      lastInFeedAt: mapping?.lastSeenAt ?? null,
      addedBy: mapping === null ? ParticipantAddedBy.ADMIN : ParticipantAddedBy.FEED,
    }));
  }

  /** The league's positions with their provider codes (#2001). Null when the league does not exist. */
  async listPositions(sportLeagueId: string): Promise<SportLeaguePosition[] | null> {
    return this.deps.reader.readPositions(sportLeagueId);
  }

  /**
   * The league's phase and slot definitions with their provider mappings (#2002), in their one
   * order. Null when the league does not exist.
   */
  async getStructure(sportLeagueId: string): Promise<SportLeagueStructure | null> {
    const phases = await this.deps.reader.readStructure(sportLeagueId);
    return phases === null ? null : orderSportLeagueStructure(phases);
  }

  /**
   * The league's Seasons with their provider ids, phases and slots (#2003), latest first, each in
   * play order. Null when the league does not exist.
   */
  async listSeasons(sportLeagueId: string): Promise<SportLeagueSeasonDetail[] | null> {
    const seasons = await this.deps.reader.readSeasons(sportLeagueId);
    return seasons === null ? null : orderSportLeagueSeasons(seasons);
  }

  /** The Event page's header and sync rows (#1889). Null when the event does not exist. */
  async getEventOverview(sportEventId: string): Promise<SportEventOverview | null> {
    const now = this.now();
    const facts = await this.deps.reader.readEventPageFacts(sportEventId, now);
    return facts === null ? null : buildSportEventOverview(facts, { webhookProviderIds: this.deps.webhookProviderIds(), now });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}


/**
 * One row per sync kind, in kind order: its health by the overview's rule from its latest run,
 * that run, and whether a webhook or the schedule drives it. The live scores of a provider whose
 * webhooks are on follow the webhook; every other sync runs on the one schedule (#1997: the page
 * no longer works out the schedule's next run itself).
 */
export function buildSportLeagueSyncs(
  league: SportLeaguePageLeague,
  latestRuns: readonly SportLeaguePageRun[],
  context: { webhookProviderIds: readonly string[] },
): SportLeagueSync[] {
  const providerId = league.syncProviderId;
  return Object.values(ProviderSyncKind)
    .sort(compareByEnumOrder(ProviderSyncKindOrder))
    .map((kind): SportLeagueSync => {
      const run = latestRuns.find((candidate) => candidate.kind === kind) ?? null;
      const health = syncHealthOf({
        isActive: league.isActive,
        providerId,
        runCount: run === null ? 0 : 1,
        failedRunCount: run?.status === ProviderSyncRunStatus.FAILED ? 1 : 0,
      });
      const mode = kind === ProviderSyncKind.SCORES && providerId !== null && context.webhookProviderIds.includes(providerId)
        ? SportLeagueSyncMode.WEBHOOK
        : SportLeagueSyncMode.SCHEDULE;
      return {
        kind,
        health,
        mode,
        lastRun: run === null
          ? null
          : { id: run.id, status: run.status, createdAt: run.createdAt, startedAt: run.startedAt, summary: run.summary, changedCount: run.changedCount },
      };
    });
}

/** Every event of the league, by start then id, with its release, field, issues and last sync. */
export function buildSportLeagueEvents(facts: SportLeagueEventFacts, now: Date): SportLeagueEventOverview[] {
  const overdueById = new Map(facts.overdueCandidates.map((event) => [event.id, event]));
  return facts.events.map((event): SportLeagueEventOverview => {
    const runs = facts.latestRunsByEvent.get(event.id) ?? [];
    const failedRuns = runs.filter((run) => run.status === ProviderSyncRunStatus.FAILED);
    const check = event.lastReleaseCheck;
    const held = event.status === SportEventStatus.DRAFT && check?.outcome === AutoReleaseCheckOutcome.HELD
      ? [{ id: event.id, name: event.name, checkedAt: check.checkedAt, failedChecks: check.failedChecks }]
      : [];
    const overdue = overdueById.get(event.id);
    const release = sportEventReleaseOf(event, facts.league);
    const lastSyncedAt = runs.reduce<Date | null>((latest, run) => (latest === null || run.createdAt > latest ? run.createdAt : latest), null);
    return {
      id: event.id,
      name: event.name,
      sportLeagueSeasonId: event.sportLeagueSeasonId,
      startDate: event.startDate,
      endDate: event.endDate,
      status: event.status,
      ...release,
      lastReleaseCheck: check,
      fieldSize: facts.fieldSizes.get(event.id) ?? null,
      issues: issuesOf(failedRuns, held, overdue === undefined ? [] : [overdue], now),
      lastSyncedAt,
    };
  });
}

/**
 * AUTO when the league releases its synced drafts on its own and the event is synced, else
 * MANUAL. A released event's date is when it was released; an automatic draft's is when its
 * league's window opens, its start less the window. A manual draft, or an event released before
 * release times were kept, has none.
 */
export function sportEventReleaseOf(event: SportLeaguePageEvent, league: SportLeaguePageLeague): Pick<SportLeagueEventOverview, 'releaseMode' | 'releaseAt' | 'releaseAtKind'> {
  const days = league.isActive ? league.autoReleaseDaysBeforeStart : null;
  const synced = !event.isTestData;
  const releaseMode = days !== null && synced ? SportEventReleaseMode.AUTO : SportEventReleaseMode.MANUAL;
  if (event.status !== SportEventStatus.DRAFT) {
    return event.releasedAt === null
      ? { releaseMode, releaseAt: null, releaseAtKind: null }
      : { releaseMode, releaseAt: event.releasedAt, releaseAtKind: SportEventReleaseAtKind.ACTUAL };
  }
  if (releaseMode === SportEventReleaseMode.AUTO && days !== null) {
    return { releaseMode, releaseAt: new Date(event.startDate.getTime() - days * DAY_MS), releaseAtKind: SportEventReleaseAtKind.PLANNED };
  }
  return { releaseMode, releaseAt: null, releaseAtKind: null };
}

/** The syncs that run on one event: its field and its live scores and results. The event list is the league's. */
const EVENT_SYNC_KINDS: readonly ProviderSyncKind[] = [ProviderSyncKind.FIELD, ProviderSyncKind.SCORES];

/**
 * One event's overview (#1889), by the League page's rules: its field and scores syncs from its
 * own latest runs (all OFF for an event no provider syncs, such as one an admin made in a synced
 * league), its health from those runs, its issues and release as its League page row has them,
 * and the value its active field is ordered by for tiers and prices (`fieldOrderDecision`).
 */
export function buildSportEventOverview(
  facts: SportEventPageFacts,
  context: { webhookProviderIds: readonly string[]; now: Date },
): SportEventOverview {
  const { league, event, latestRuns } = facts;
  const synced = !event.isTestData;
  // An event no provider syncs reads as a league no provider syncs: every row OFF, nothing scheduled.
  const syncLeague = synced ? league : { ...league, syncProviderId: null };
  const eventRuns = latestRuns.filter((run) => EVENT_SYNC_KINDS.includes(run.kind));
  const syncs = buildSportLeagueSyncs(syncLeague, eventRuns, context).filter((sync) => EVENT_SYNC_KINDS.includes(sync.kind));
  const failedRuns = eventRuns.filter((run) => run.status === ProviderSyncRunStatus.FAILED);
  const check = event.lastReleaseCheck;
  const held = event.status === SportEventStatus.DRAFT && check?.outcome === AutoReleaseCheckOutcome.HELD
    ? [{ id: event.id, name: event.name, checkedAt: check.checkedAt, failedChecks: check.failedChecks }]
    : [];
  const active = facts.field.filter((row) => row.isActive);
  const decision = active.length === 0 ? null : fieldOrderDecision(active);
  return {
    syncHealth: syncHealthOf({
      isActive: syncLeague.isActive,
      providerId: synced ? league.syncProviderId : null,
      runCount: eventRuns.length,
      failedRunCount: failedRuns.length,
    }),
    syncs,
    issues: issuesOf(failedRuns, held, facts.overdueCandidates.filter((candidate) => candidate.id === event.id), context.now),
    ...sportEventReleaseOf(event, league),
    tierOrderBasis: decision?.basis ?? null,
    tierOrderCoversField: decision?.coversField ?? true,
    fieldFeed: facts.field.map((row) => ({
      sportEventParticipantId: row.id,
      feedId: row.mapping?.externalId ?? null,
      lastInFeedAt: row.mapping?.lastSeenAt ?? null,
    })),
    eventPagePath: facts.eventPagePath,
  };
}

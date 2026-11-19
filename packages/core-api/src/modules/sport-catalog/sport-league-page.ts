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
import type { IngestionFeedSchedulePolicy, IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import {
  AutoReleaseCheckOutcome,
  compareByEnumOrder,
  fieldOrderDecision,
  isClutchCardLeague,
  isProviderSyncedEvent,
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
  type SportLeagueSync,
} from '@poolmaster/shared/domain';
import { schedulePolicyDelayMs } from '../../core/schedule-policy-delay';
import { issuesOf, syncHealthOf } from './sport-league-overview';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SportLeaguePageServiceDeps {
  reader: SportLeaguePageReader;
  /** The one ingestion schedule every sport league syncs on (#1871). */
  schedule: { getConfig(): Promise<IngestionScheduleConfig> };
  /** The providers whose webhook drives their live scores, with a poll only while an event is in play (#1499). */
  webhookProviderIds: readonly string[];
  now?: () => Date;
}

export class SportLeaguePageService {
  constructor(private readonly deps: SportLeaguePageServiceDeps) {}

  /** Null when the league does not exist. */
  async listSyncs(sportLeagueId: string): Promise<SportLeagueSync[] | null> {
    const [facts, schedule] = await Promise.all([this.deps.reader.readSyncFacts(sportLeagueId), this.deps.schedule.getConfig()]);
    if (facts === null) return null;
    return buildSportLeagueSyncs(facts.league, facts.latestRuns, { schedule, webhookProviderIds: this.deps.webhookProviderIds, now: this.now() });
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

  /** The Event page's header and sync rows (#1889). Null when the event does not exist. */
  async getEventOverview(sportEventId: string): Promise<SportEventOverview | null> {
    const now = this.now();
    const [facts, schedule] = await Promise.all([this.deps.reader.readEventPageFacts(sportEventId, now), this.deps.schedule.getConfig()]);
    return facts === null ? null : buildSportEventOverview(facts, { schedule, webhookProviderIds: this.deps.webhookProviderIds, now });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** The provider that syncs the league's events: a Clutch Card's parent's, whose event list sync creates them. */
function providerOf(league: SportLeaguePageLeague): string | null {
  return isClutchCardLeague(league) && league.parent !== null ? league.parent.eventSyncProviderId : league.eventSyncProviderId;
}

const POLICY_OF: Record<ProviderSyncKind, (schedule: IngestionScheduleConfig) => IngestionFeedSchedulePolicy> = {
  [ProviderSyncKind.EVENTS]: (schedule) => schedule.eventList,
  [ProviderSyncKind.FIELD]: (schedule) => schedule.eventParticipants,
  [ProviderSyncKind.SCORES]: (schedule) => schedule.eventLiveScores,
};

/**
 * One row per sync kind, in kind order: its health by the overview's rule from its latest run,
 * that run, and when it runs next. The live scores of a provider whose webhook is set follow the
 * webhook, so no schedule names their next run. Otherwise the next run is an interval of the
 * sync's policy after the latest run (now, if that time has passed or it has never run); none
 * while the league or the policy is off, or its sport is not scheduled.
 */
export function buildSportLeagueSyncs(
  league: SportLeaguePageLeague,
  latestRuns: readonly SportLeaguePageRun[],
  context: { schedule: IngestionScheduleConfig; webhookProviderIds: readonly string[]; now: Date },
): SportLeagueSync[] {
  const providerId = providerOf(league);
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
      const policy = POLICY_OF[kind](context.schedule);
      const scheduled = league.isActive && providerId !== null && mode === SportLeagueSyncMode.SCHEDULE
        && policy.enabled && context.schedule.scheduledSports.includes(league.sport);
      const next = run === null ? context.now.getTime() : run.createdAt.getTime() + schedulePolicyDelayMs(policy);
      return {
        kind,
        health,
        mode,
        lastRun: run === null
          ? null
          : { id: run.id, status: run.status, createdAt: run.createdAt, startedAt: run.startedAt, summary: run.summary, changedCount: run.changedCount },
        nextRunAt: scheduled ? new Date(Math.max(next, context.now.getTime())) : null,
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
      eventYear: event.eventYear,
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
  const synced = isProviderSyncedEvent({ providerId: event.providerId, syncScope: event.syncScope, eventSyncProviderId: league.eventSyncProviderId ?? undefined });
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
  context: { schedule: IngestionScheduleConfig; webhookProviderIds: readonly string[]; now: Date },
): SportEventOverview {
  const { league, event, latestRuns } = facts;
  const synced = isProviderSyncedEvent({ providerId: event.providerId, syncScope: event.syncScope, eventSyncProviderId: league.eventSyncProviderId ?? undefined });
  // An event no provider syncs reads as a league no provider syncs: every row OFF, nothing scheduled.
  const syncLeague = synced ? league : { ...league, eventSyncProviderId: null, parent: null };
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
      providerId: synced ? providerOf(league) : null,
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
    eventPageSlug: facts.eventPageSlug,
  };
}

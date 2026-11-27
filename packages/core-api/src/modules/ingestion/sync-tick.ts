/**
 * The sync tick (#2009): the one scheduler of provider syncs. Every server task starts it, and each
 * minute the task holding its lock reads what is due and queues it as jobs, in one write; the job
 * runner makes every provider call. Nothing is remembered between ticks: each sync is paced by its
 * subject's latest job, read from the jobs table.
 *
 * - EVENTS: each active synced league's events sync (`SYNC_LEAGUE_EVENTS`), on the EVENTS interval
 *   while that schedule is on.
 * - FIELD: the field of each event in its league's next slot (`fieldWindowEventIds`), judged by the
 *   slot's start, never by status, on the FIELD interval. It has no switch (#2086).
 * - SCORES: the scores of each linked event with a Game due or in play (`isGameScoresDue`), on the
 *   SCORES interval while that schedule is on, or, for a provider that sends webhooks, at its
 *   safety-net pace (#1499). The tick warns when such an event in play has gone quiet.
 * - NO_PROVIDER_LIVE_SCORES (#2094): an event in play whose scores have not changed, nor its
 *   provider sent a notification, for its provider league's quiet window raises the finding, once
 *   per quiet stretch. An empty poll inside the window raises nothing: a game between scoring
 *   plays is not a problem. The next scores sync that brings updates resolves it.
 *
 * Each kind's interval is the one for its league's Season state (`syncSeasonStateOf`): in season
 * while one of the league's Seasons' spans holds now, off season otherwise.
 *
 * A league is synced while it is active and its selected mapping names a provider running here.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { BackgroundJobRepository, LiveEventView, SportLeagueRepository, SyncDueWorkReader, SyncedLeagueRef } from '@poolmaster/shared/db';
import {
  BackgroundJobType,
  fieldWindowEventIds,
  isQuietWarningDue,
  isSyncDue,
  playUnderwaySince,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncKind,
  SYNC_TICK_MS,
  syncSeasonStateOf,
  type BackgroundJobRequest,
  type ProviderCode,
  type SportLeague,
  type SyncSeasonState,
} from '@poolmaster/shared/domain';
import type { IngestionAlwaysOnSchedulePolicy, IngestionFeedSchedulePolicy, IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import type { JobLock } from '../../core/job-lock';
import type { ProviderSyncFindingService } from './findings/provider-sync-finding-service';
import { SCHEDULE_START } from '../../core/job-start';
import { LockedSweep } from '../../core/locked-sweep';
import { schedulePolicyDelayMs } from '../../core/schedule-policy-delay';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { syncLeagueEventsJob } from '../events/league-events-sync-job';
import { EVENT_SYNC_JOB_TYPES, eventSyncJob } from './event-sync-job-requests';
import type { EventSyncKind } from './core/sync-orchestrator';
import type { ProviderRegistry } from './core/provider-registry';

/**
 * How the tick paces the scores of providers that send webhook notifications (#1499). Each
 * notification syncs its event within a minute, so the tick is only their safety net: it syncs each
 * such event every `pollIntervalMs`, one played as a FIELD (a golf round) every
 * `roundPollIntervalMs`, and warns when play has gone on for its provider league's quiet window
 * with no notification. Other providers' events keep the SCORES interval.
 */
export interface NotifiedProviderCadence {
  /** The providers sending notifications, by the id their feeds carry. */
  providerIds: readonly string[];
  pollIntervalMs: number;
  roundPollIntervalMs: number;
}

const LOCK_KEY = 'sync-tick';

export interface SyncTickOptions {
  sportLeagues: Pick<SportLeagueRepository, 'findEventSynced'>;
  dueWork: SyncDueWorkReader;
  jobHistory: Pick<BackgroundJobRepository, 'findLatestRunAt'>;
  jobs: Pick<BackgroundJobQueue, 'request' | 'enqueueAll'>;
  registry: Pick<ProviderRegistry, 'all'>;
  schedule: { getConfig(): Promise<IngestionScheduleConfig> };
  /** Read each tick, so a change to a Provider row takes effect (#1997); undefined while no provider sends webhooks. */
  notifiedProviderCadence: () => NotifiedProviderCadence | undefined;
  /**
   * How long an event of a provider league (`providerLeagues.id`) may be in play with nothing
   * from its provider before the tick says so: its Provider row's `quietAfterMinutes`, read each
   * tick. Zero says never.
   */
  quietAfterMs: (providerLeagueId: string) => number;
  /**
   * Whether a provider league (`providerLeagues.id`) is notified at all: a league that subscribes
   * to no webhook events (its set is NONE, #2045) keeps the SCORES interval and is never warned
   * quiet for want of a notification, however its provider's other leagues are paced.
   */
  leagueSendsNotifications: (providerLeagueId: string) => boolean;
  /** The quiet live scores finding (#2094) is raised here. */
  findings: Pick<ProviderSyncFindingService, 'raiseOfSource'>;
  jobLock: JobLock;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

/** A synced league the tick queues for, with what its jobs name. */
interface TickLeague extends SyncedLeagueRef {
  providerCode: ProviderCode;
  providerId: string;
  /** The provider league's quiet window, read once per tick. */
  quietAfterMs: number;
  /** Whether the provider league subscribes to webhook events. */
  sendsNotifications: boolean;
  /** Which of its kind's intervals each sync takes. */
  seasonState: SyncSeasonState;
}

/** How long a league waits between runs of one sync kind: its policy's interval for the league's Season state. */
type LeagueInterval = (league: TickLeague) => number;

function intervalFor(policy: IngestionFeedSchedulePolicy | IngestionAlwaysOnSchedulePolicy): LeagueInterval {
  return (league) => schedulePolicyDelayMs(policy, league.seasonState);
}

export class SyncTick {
  private readonly sweep: LockedSweep;
  private readonly now: () => Date;

  constructor(private readonly options: SyncTickOptions) {
    this.now = options.now ?? (() => new Date());
    this.sweep = new LockedSweep({
      lockKey: LOCK_KEY,
      jobLock: options.jobLock,
      intervalMs: SYNC_TICK_MS,
      label: 'sync tick',
      logger: options.logger,
    }, () => this.tick().then(() => undefined));
  }

  start(): void {
    this.sweep.start();
    this.options.logger?.info('Sync tick started');
  }

  stop(): void {
    this.sweep.stop();
  }

  /** One tick, when this task holds the lock and no tick is still running here. Exposed so tests need not wait on the timer. */
  runTick(): Promise<void> {
    return this.sweep.run();
  }

  /** What one tick queues, written in one write; answers how many jobs were written. */
  async tick(): Promise<number> {
    const now = this.now();
    const config = await this.options.schedule.getConfig();
    const synced = this.syncedLeagues(await this.options.sportLeagues.findEventSynced());
    if (synced.length === 0) return 0;
    const leagues = await this.withSeasonStates(synced, now);
    const [events, field, scores] = await Promise.all([
      config.EVENTS.enabled ? this.eventsJobs(leagues, intervalFor(config.EVENTS), now) : [],
      this.fieldJobs(leagues, intervalFor(config.FIELD), now),
      config.SCORES.enabled ? this.scoresJobs(leagues, intervalFor(config.SCORES), now) : [],
    ]);
    // poolmaster-allow-direct-job: the sync tick queues every due provider sync
    const queued = await this.options.jobs.enqueueAll([...events, ...field, ...scores]);
    this.options.logger?.info({
      action: 'ingestion.syncTick.queued',
      data: { leagues: leagues.length, events: events.length, field: field.length, scores: scores.length, queued },
    }, 'Queued the provider syncs due this tick');
    return queued;
  }

  /** Each league with its Season state, from one read of the Seasons not yet ended. */
  private async withSeasonStates(leagues: ReadonlyArray<Omit<TickLeague, 'seasonState'>>, now: Date): Promise<TickLeague[]> {
    const spans = await this.options.dueWork.findSeasonSpans({ leagues, now });
    return leagues.map((league) => ({
      ...league,
      seasonState: syncSeasonStateOf(spans.filter((span) => span.sportLeagueId === league.sportLeagueId), now),
    }));
  }

  /** Each active league synced from a provider running here (#2073). */
  private syncedLeagues(leagues: readonly SportLeague[]): Array<Omit<TickLeague, 'seasonState'>> {
    const running = new Set(this.options.registry.all().map((provider) => provider.providerCode));
    return leagues.flatMap((league) => {
      const mapping = league.selectedProviderMapping;
      if (!league.isActive || mapping === null || !running.has(mapping.providerCode)) return [];
      return [{
        sportLeagueId: league.id,
        sportLeagueProviderMappingId: mapping.id,
        providerCode: mapping.providerCode,
        providerId: mapping.providerId,
        quietAfterMs: this.options.quietAfterMs(mapping.providerLeagueId),
        sendsNotifications: this.options.leagueSendsNotifications(mapping.providerLeagueId),
      }];
    });
  }

  private async eventsJobs(leagues: readonly TickLeague[], intervalMs: LeagueInterval, now: Date): Promise<BackgroundJobRequest[]> {
    const lastRunAt = await this.options.jobHistory.findLatestRunAt({
      type: BackgroundJobType.SYNC_LEAGUE_EVENTS,
      by: 'sportLeagueId',
      ids: leagues.map((league) => league.sportLeagueId),
      dueBy: now,
    });
    return leagues
      .filter((league) => isSyncDue(lastRunAt.get(league.sportLeagueId), intervalMs(league), now))
      .map((league) => syncLeagueEventsJob(this.options.jobs, { sportLeagueId: league.sportLeagueId }, { start: SCHEDULE_START, providerCode: league.providerCode }));
  }

  private async fieldJobs(leagues: readonly TickLeague[], intervalMs: LeagueInterval, now: Date): Promise<BackgroundJobRequest[]> {
    const slots = await this.options.dueWork.findNextSlots({ leagues, now });
    const eventIds = fieldWindowEventIds(slots, now);
    const leagueOfEvent = new Map(slots.map((slot) => [slot.sportEventId, slot.sportLeagueId]));
    const lastRunAt = await this.latestEventJobs(ProviderSyncKind.FIELD, eventIds, now);
    const leaguesById = new Map(leagues.map((league) => [league.sportLeagueId, league]));
    return eventIds.flatMap((sportEventId) => {
      const league = leaguesById.get(leagueOfEvent.get(sportEventId) ?? '');
      if (league === undefined || !isSyncDue(lastRunAt.get(sportEventId), intervalMs(league), now)) return [];
      return [eventSyncJob(this.options.jobs, ProviderSyncKind.FIELD, { sportEventId }, { start: SCHEDULE_START, providerCode: league.providerCode })];
    });
  }

  private async scoresJobs(leagues: readonly TickLeague[], intervalMs: LeagueInterval, now: Date): Promise<BackgroundJobRequest[]> {
    const live = await this.options.dueWork.findLiveEvents({ leagues, now });
    const lastRunAt = await this.latestEventJobs(ProviderSyncKind.SCORES, live.map((event) => event.sportEventId), now);
    const cadence = this.options.notifiedProviderCadence();
    const leaguesById = new Map(leagues.map((league) => [league.sportLeagueId, league]));
    await this.raiseQuietLiveScores(live, leaguesById, now);
    return live.flatMap((event) => {
      const league = leaguesById.get(event.sportLeagueId);
      if (league === undefined) return [];
      const notified = league.sendsNotifications && cadence !== undefined && cadence.providerIds.includes(league.providerId);
      if (notified) this.warnIfQuiet(event, league, now);
      const eventIntervalMs = !notified
        ? intervalMs(league)
        : event.games.some((game) => game.playedAsField) ? cadence.roundPollIntervalMs : cadence.pollIntervalMs;
      if (!isSyncDue(lastRunAt.get(event.sportEventId), eventIntervalMs, now)) return [];
      return [eventSyncJob(this.options.jobs, ProviderSyncKind.SCORES, { sportEventId: event.sportEventId }, { start: SCHEDULE_START, providerCode: league.providerCode })];
    });
  }

  private latestEventJobs(kind: EventSyncKind, sportEventIds: readonly string[], now: Date): Promise<Map<string, Date>> {
    return this.options.jobHistory.findLatestRunAt({ type: EVENT_SYNC_JOB_TYPES[kind], by: 'sportEventId', ids: sportEventIds, dueBy: now });
  }

  /**
   * Warns, once per quiet stretch of its league's `quietAfterMs`, that a notified provider's event
   * has been in play that long with no notification about it: its webhook may have stopped, and
   * until it is fixed its scores move only at the safety-net pace. The warning's action is what
   * the log alarm counts (infrastructure/terraform).
   */
  private warnIfQuiet(event: LiveEventView, league: TickLeague, now: Date): void {
    const since = playUnderwaySince(event.games, now);
    if (since === null) return;
    if (!isQuietWarningDue({ playUnderwaySince: since, lastHeardAt: event.lastHeardAt, quietAfterMs: league.quietAfterMs, now, tickMs: SYNC_TICK_MS })) return;
    const heardFrom = Math.max(since.getTime(), event.lastHeardAt?.getTime() ?? 0);
    this.options.logger?.warn({
      action: 'ingestion.providerNotifications.quiet',
      data: {
        sportEventId: event.sportEventId,
        providerId: league.providerId,
        playUnderwaySince: since.toISOString(),
        lastProviderNotificationAt: event.lastHeardAt?.toISOString() ?? null,
        quietMinutes: Math.floor((now.getTime() - heardFrom) / 60_000),
      },
    }, 'An event in play has had no webhook notification from its provider for a while; its webhook may have stopped');
  }

  /**
   * The events in play whose live scores have been quiet for their provider league's window
   * (#2094): nothing changed by a scores sync and no notification since play got under way, or
   * since the last of either. Raised on the tick that crosses each whole window, so a long quiet
   * stretch counts its sightings without a raise every tick. One raise per provider. A findings
   * write that fails is logged and never stops the tick scheduling live scores.
   */
  private async raiseQuietLiveScores(live: readonly LiveEventView[], leaguesById: ReadonlyMap<string, TickLeague>, now: Date): Promise<void> {
    const bySource = new Map<string, { sportLeagueId: string; sportEventId: string }[]>();
    for (const event of live) {
      const league = leaguesById.get(event.sportLeagueId);
      const since = playUnderwaySince(event.games, now);
      if (league === undefined || since === null) continue;
      const lastHeardAt = latestOf(event.lastHeardAt, event.lastScoresChangedAt);
      if (!isQuietWarningDue({ playUnderwaySince: since, lastHeardAt, quietAfterMs: league.quietAfterMs, now, tickMs: SYNC_TICK_MS })) continue;
      const events = bySource.get(league.providerId) ?? [];
      events.push({ sportLeagueId: league.sportLeagueId, sportEventId: event.sportEventId });
      bySource.set(league.providerId, events);
    }
    for (const [providerId, events] of bySource) {
      try {
        await this.options.findings.raiseOfSource(providerId, events.map((event) => ({
          kind: ProviderSyncFindingKind.NO_PROVIDER_LIVE_SCORES,
          severity: ProviderSyncFindingSeverity.WARNING,
          sportLeagueId: event.sportLeagueId,
          sportEventId: event.sportEventId,
          providerValue: null,
          providerValueName: null,
        })));
      } catch (error) {
        this.options.logger?.error(
          { action: 'ingestion.syncFinding.quietLiveScoresFailed', data: { providerId, sportEventIds: events.map((event) => event.sportEventId) }, err: error },
          'Could not raise No live scores for the quiet events in play',
        );
      }
    }
  }
}

function latestOf(left: Date | null, right: Date | null): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

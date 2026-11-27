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
  ProviderSyncKind,
  SYNC_TICK_MS,
  type BackgroundJobRequest,
  type ProviderCode,
  type SportLeague,
} from '@poolmaster/shared/domain';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import type { JobLock } from '../../core/job-lock';
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
 * `roundPollIntervalMs`, and warns when play has gone on for its league's `quietAfterMs` with no
 * notification. Other providers' events keep the SCORES interval.
 */
export interface NotifiedProviderCadence {
  /** The providers sending notifications, by the id their feeds carry. */
  providerIds: readonly string[];
  pollIntervalMs: number;
  roundPollIntervalMs: number;
  /** How long an event of this provider league may be in play with no notification before the tick warns. */
  quietAfterMs: (providerLeagueCode: string) => number;
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
  jobLock: JobLock;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

/** A synced league the tick queues for, with what its jobs name. */
interface TickLeague extends SyncedLeagueRef {
  providerCode: ProviderCode;
  providerId: string;
  providerLeagueCode: string;
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
    const leagues = this.syncedLeagues(await this.options.sportLeagues.findEventSynced());
    if (leagues.length === 0) return 0;
    const [events, field, scores] = await Promise.all([
      config.EVENTS.enabled ? this.eventsJobs(leagues, schedulePolicyDelayMs(config.EVENTS), now) : [],
      this.fieldJobs(leagues, schedulePolicyDelayMs(config.FIELD), now),
      config.SCORES.enabled ? this.scoresJobs(leagues, schedulePolicyDelayMs(config.SCORES), now) : [],
    ]);
    // poolmaster-allow-direct-job: the sync tick queues every due provider sync
    const queued = await this.options.jobs.enqueueAll([...events, ...field, ...scores]);
    this.options.logger?.info({
      action: 'ingestion.syncTick.queued',
      data: { leagues: leagues.length, events: events.length, field: field.length, scores: scores.length, queued },
    }, 'Queued the provider syncs due this tick');
    return queued;
  }

  /** Each active league synced from a provider running here (#2073). */
  private syncedLeagues(leagues: readonly SportLeague[]): TickLeague[] {
    const running = new Set(this.options.registry.all().map((provider) => provider.providerCode));
    return leagues.flatMap((league) => {
      const mapping = league.selectedProviderMapping;
      if (!league.isActive || mapping === null || !running.has(mapping.providerCode)) return [];
      return [{
        sportLeagueId: league.id,
        sportLeagueProviderMappingId: mapping.id,
        providerCode: mapping.providerCode,
        providerId: mapping.providerId,
        providerLeagueCode: mapping.providerLeagueCode,
      }];
    });
  }

  private async eventsJobs(leagues: readonly TickLeague[], intervalMs: number, now: Date): Promise<BackgroundJobRequest[]> {
    const lastRunAt = await this.options.jobHistory.findLatestRunAt({
      type: BackgroundJobType.SYNC_LEAGUE_EVENTS,
      by: 'sportLeagueId',
      ids: leagues.map((league) => league.sportLeagueId),
    });
    return leagues
      .filter((league) => isSyncDue(lastRunAt.get(league.sportLeagueId), intervalMs, now))
      .map((league) => syncLeagueEventsJob(this.options.jobs, { sportLeagueId: league.sportLeagueId }, { start: SCHEDULE_START, providerCode: league.providerCode }));
  }

  private async fieldJobs(leagues: readonly TickLeague[], intervalMs: number, now: Date): Promise<BackgroundJobRequest[]> {
    const slots = await this.options.dueWork.findNextSlots({ leagues, now });
    const eventIds = fieldWindowEventIds(slots, now);
    const leagueOfEvent = new Map(slots.map((slot) => [slot.sportEventId, slot.sportLeagueId]));
    const lastRunAt = await this.latestEventJobs(ProviderSyncKind.FIELD, eventIds);
    const leaguesById = new Map(leagues.map((league) => [league.sportLeagueId, league]));
    return eventIds.flatMap((sportEventId) => {
      const league = leaguesById.get(leagueOfEvent.get(sportEventId) ?? '');
      if (league === undefined || !isSyncDue(lastRunAt.get(sportEventId), intervalMs, now)) return [];
      return [eventSyncJob(this.options.jobs, ProviderSyncKind.FIELD, { sportEventId }, { start: SCHEDULE_START, providerCode: league.providerCode })];
    });
  }

  private async scoresJobs(leagues: readonly TickLeague[], intervalMs: number, now: Date): Promise<BackgroundJobRequest[]> {
    const live = await this.options.dueWork.findLiveEvents({ leagues, now });
    const lastRunAt = await this.latestEventJobs(ProviderSyncKind.SCORES, live.map((event) => event.sportEventId));
    const cadence = this.options.notifiedProviderCadence();
    const leaguesById = new Map(leagues.map((league) => [league.sportLeagueId, league]));
    return live.flatMap((event) => {
      const league = leaguesById.get(event.sportLeagueId);
      if (league === undefined) return [];
      const notified = cadence !== undefined && cadence.providerIds.includes(league.providerId);
      if (notified) this.warnIfQuiet(event, league, cadence, now);
      const eventIntervalMs = !notified
        ? intervalMs
        : event.games.some((game) => game.playedAsField) ? cadence.roundPollIntervalMs : cadence.pollIntervalMs;
      if (!isSyncDue(lastRunAt.get(event.sportEventId), eventIntervalMs, now)) return [];
      return [eventSyncJob(this.options.jobs, ProviderSyncKind.SCORES, { sportEventId: event.sportEventId }, { start: SCHEDULE_START, providerCode: league.providerCode })];
    });
  }

  private latestEventJobs(kind: EventSyncKind, sportEventIds: readonly string[]): Promise<Map<string, Date>> {
    return this.options.jobHistory.findLatestRunAt({ type: EVENT_SYNC_JOB_TYPES[kind], by: 'sportEventId', ids: sportEventIds });
  }

  /**
   * Warns, once per quiet stretch of its league's `quietAfterMs`, that a notified provider's event
   * has been in play that long with no notification about it: its webhook may have stopped, and
   * until it is fixed its scores move only at the safety-net pace. The warning's action is what
   * the log alarm counts (infrastructure/terraform).
   */
  private warnIfQuiet(event: LiveEventView, league: TickLeague, cadence: NotifiedProviderCadence, now: Date): void {
    const since = playUnderwaySince(event.games, now);
    if (since === null) return;
    const quietAfterMs = cadence.quietAfterMs(league.providerLeagueCode);
    if (!isQuietWarningDue({ playUnderwaySince: since, lastHeardAt: event.lastHeardAt, quietAfterMs, now, tickMs: SYNC_TICK_MS })) return;
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
}

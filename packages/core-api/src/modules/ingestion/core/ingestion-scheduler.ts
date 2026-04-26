/**
 * IngestionScheduler — orchestrates periodic data polling from providers.
 *
 * Schedules jobs for:
 * - Event schedule sync (daily)
 * - Event participant hydration (daily)
 * - Ranking updates (daily)
 * - Live score polling (every 30s during active events)
 * - Provider health checks (every 5 min)
 */

import type { Sport } from '@poolmaster/shared/domain';
import type { IngestionScheduleConfig } from '@poolmaster/shared/dto/config.dto';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderRegistry } from './provider-registry';
import type {
  ProviderRanking,
  ProviderStatEvent,
  SportEvent,
  SportEventDetail,
} from './provider-interface';

export type IngestionFeedType =
  | 'EVENTSCHEDULE'
  | 'EVENTPARTICIPANTS'
  | 'PARTICIPANTRANKINGS'
  | 'EVENTLIVESCORES'
  | 'EVENTRESULTS';

export type JobType =
  | 'EVENT_SCHEDULE_SYNC'
  | 'EVENT_PARTICIPANTS_SYNC'
  | 'PARTICIPANT_RANKINGS_SYNC'
  | 'EVENT_LIVE_SCORES_SYNC'
  | 'EVENT_RESULTS_SYNC'
  | 'HEALTH_CHECK';

export interface IngestionJobRecord {
  jobType: JobType;
  providerId: string;
  sport: Sport;
  eventExternalId?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt?: Date;
  completedAt?: Date;
  recordsProcessed: number;
  errors: number;
  errorLog: unknown[];
}

export interface SportSyncRequest {
  sport: Sport;
  feeds: Array<'EVENTSCHEDULE' | 'EVENTPARTICIPANTS' | 'PARTICIPANTRANKINGS'>;
  from?: Date;
  to?: Date;
}

export interface EventSyncRequest {
  sport: Sport;
  eventId: string;
  feeds: Array<'EVENTPARTICIPANTS' | 'EVENTLIVESCORES' | 'EVENTRESULTS'>;
}

export interface IngestionCallbacks {
  onEvents(events: SportEvent[]): Promise<void>;
  onEventDetail(detail: SportEventDetail): Promise<void>;
  onRankings(rankings: ProviderRanking[]): Promise<void>;
  onLiveScores(scores: ProviderStatEvent[]): Promise<void>;
  onJobComplete(job: IngestionJobRecord): Promise<void>;
}

export interface IngestionScheduleConfigReader {
  getConfig(): Promise<IngestionScheduleConfig>;
  getPerSportConfig(sport: string): Promise<IngestionScheduleConfig>;
}

export interface IngestionScheduledEventReader {
  listEventIdsForFeed(input: {
    sport: Sport;
    feed: 'EVENTLIVESCORES' | 'EVENTRESULTS';
    now: Date;
  }): Promise<string[]>;
}

export interface IngestionSchedulerOptions {
  configReader?: IngestionScheduleConfigReader;
  eventReader?: IngestionScheduledEventReader;
  now?: () => Date;
}

export class IngestionScheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly callbacks: IngestionCallbacks,
    private readonly logger?: FastifyBaseLogger,
    private readonly options: IngestionSchedulerOptions = {},
  ) {}

  /** Starts all scheduled ingestion jobs. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger?.debug('Starting ingestion scheduler');
    this.startRecurringLoop(
      'health checks',
      async () => this.runHealthChecks(),
      async () => this.getGlobalDelayMs('healthCheck'),
    );

    for (const sport of this.registry.getSupportedSports()) {
      this.startRecurringLoop(
        `${sport} schedule sync`,
        async () => this.runConfiguredSportScheduleSync(sport),
        async () => this.getSportDelayMs(sport, 'eventSchedule'),
      );
      this.startRecurringLoop(
        `${sport} participant sync`,
        async () => this.runConfiguredSportFieldSync(sport),
        async () => this.getSportDelayMs(sport, 'eventParticipants'),
      );
      this.startRecurringLoop(
        `${sport} ranking sync`,
        async () => this.runConfiguredSportRankingSync(sport),
        async () => this.getSportDelayMs(sport, 'participantRankings'),
      );
      this.startRecurringLoop(
        `${sport} live score sync`,
        async () => this.runConfiguredEventSyncSweep(sport, 'EVENTLIVESCORES'),
        async () => this.getSportDelayMs(sport, 'eventLiveScores'),
      );
      this.startRecurringLoop(
        `${sport} results sync`,
        async () => this.runConfiguredEventSyncSweep(sport, 'EVENTRESULTS'),
        async () => this.getSportDelayMs(sport, 'eventResults'),
      );
    }

    this.logger?.info('Ingestion scheduler started');
  }

  /** Stops all scheduled jobs. */
  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    this.logger?.info('Ingestion scheduler stopped');
  }

  /** Backward-compatible wrapper for a schedule-only sport sync. */
  async syncSport(sport: Sport): Promise<IngestionJobRecord> {
    return this.runScheduleSync(sport);
  }

  /** Runs a one-off sport sync for explicit feed types. */
  async runSportSync(request: SportSyncRequest): Promise<IngestionJobRecord[]> {
    const jobs: IngestionJobRecord[] = [];
    this.logger?.info({
      sport: request.sport,
      feeds: request.feeds,
      from: request.from?.toISOString() ?? null,
      to: request.to?.toISOString() ?? null,
    }, 'Manual or direct sport sync requested');

    for (const feed of dedupe(request.feeds)) {
      if (feed === 'EVENTSCHEDULE') {
        jobs.push(await this.runScheduleSync(request.sport, request.from, request.to));
        continue;
      }

      if (feed === 'EVENTPARTICIPANTS') {
        jobs.push(await this.runFieldSync(request.sport, request.from, request.to));
        continue;
      }

      jobs.push(await this.runRankingSync(request.sport));
    }

    this.logger?.info({
      sport: request.sport,
      feeds: request.feeds,
      jobs: jobs.map(toJobLogPayload),
    }, 'Manual or direct sport sync completed');

    return jobs;
  }

  /** Runs a one-off event sync for explicit feed types. */
  async runEventSync(request: EventSyncRequest): Promise<IngestionJobRecord[]> {
    const jobs: IngestionJobRecord[] = [];
    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      feeds: request.feeds,
    }, 'Manual or direct event sync requested');

    for (const feed of dedupe(request.feeds)) {
      if (feed === 'EVENTPARTICIPANTS') {
        jobs.push(await this.runEventFieldSync(request.sport, request.eventId));
        continue;
      }

      if (feed === 'EVENTLIVESCORES') {
        jobs.push(await this.pollLiveScores(request.sport, request.eventId));
        continue;
      }

      jobs.push(await this.fetchEventResults(request.sport, request.eventId));
    }

    this.logger?.info({
      sport: request.sport,
      eventId: request.eventId,
      feeds: request.feeds,
      jobs: jobs.map(toJobLogPayload),
    }, 'Manual or direct event sync completed');

    return jobs;
  }

  /** Polls live scores for a specific event. */
  async pollLiveScores(sport: Sport, eventId: string): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId }, 'Polling live scores for event');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for live score polling');
      return createFailedJob('EVENT_LIVE_SCORES_SYNC', 'none', sport, 'No provider registered', eventId);
    }

    return this.runJob('EVENT_LIVE_SCORES_SYNC', provider.providerId, sport, async () => {
      const scores = await provider.getLiveScores(eventId);
      this.logger?.debug({
        sport,
        eventId,
        providerId: provider.providerId,
        scoresReturned: scores.length,
      }, 'Provider returned live scores');
      await this.callbacks.onLiveScores(scores);
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        scoresProcessed: scores.length,
      }, 'Completed live score poll');
      return scores.length;
    }, eventId);
  }

  /** Fetches final results for a completed event. */
  async fetchEventResults(sport: Sport, eventId: string): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId }, 'Fetching event results');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for event results fetch');
      return createFailedJob('EVENT_RESULTS_SYNC', 'none', sport, 'No provider registered', eventId);
    }

    return this.runJob('EVENT_RESULTS_SYNC', provider.providerId, sport, async () => {
      const results = await provider.getEventResults(eventId);
      if (!results) {
        this.logger?.warn({ sport, eventId, providerId: provider.providerId }, 'Provider returned no event results');
        return 0;
      }

      const statEvents: ProviderStatEvent[] = results.results.map((result) => ({
        id: `${eventId}-${result.participantExternalId}-result`,
        eventExternalId: eventId,
        participantExternalId: result.participantExternalId,
        statKey: 'FINISH_POSITION',
        statValue: result.finishPosition,
        timestamp: new Date(),
        isCorrection: false,
        providerId: provider.providerId,
      }));
      this.logger?.debug({
        sport,
        eventId,
        providerId: provider.providerId,
        resultsReturned: results.results.length,
      }, 'Provider returned event results');
      await this.callbacks.onLiveScores(statEvents);
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        resultsProcessed: results.results.length,
      }, 'Completed event results fetch');
      return results.results.length;
    }, eventId);
  }

  private async runHealthChecks(): Promise<void> {
    this.logger?.debug('Running provider health checks');
    const providers = this.registry.getAllProviders();
    for (const provider of providers) {
      try {
        const health = await provider.healthCheck();
        this.registry.updateHealth(provider.providerId, health);
        this.logger?.info({
          providerId: provider.providerId,
          status: health.status,
        }, 'Completed provider health check');
      } catch {
        this.registry.updateHealth(provider.providerId, {
          providerId: provider.providerId,
          status: 'DOWN',
          errorRateLastHour: 1,
          latencyMsP95: 0,
          message: 'Health check threw exception',
        });
        this.logger?.error({ providerId: provider.providerId }, 'Provider health check threw exception');
      }
    }
  }

  private async syncAllSchedules(): Promise<void> {
    this.logger?.debug('Running startup/interval schedule sync sweep');
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      try {
        await this.runScheduleSync(sport);
      } catch {
        this.logger?.error({ sport }, 'Schedule sync sweep failed for sport');
      }
    }
  }

  private async runConfiguredSportScheduleSync(sport: Sport): Promise<void> {
    const config = await this.getSportConfig(sport);
    if (!config.eventSchedule.enabled) {
      this.logger?.debug({ sport }, 'Skipping scheduled sport schedule sync because it is disabled');
      return;
    }

    const now = this.getNow();
    const lookaheadDays = config.eventSchedule.lookaheadDays ?? 30;
    const from = now;
    const to = addDays(now, lookaheadDays);
    this.logger?.debug({
      sport,
      from: from.toISOString(),
      to: to.toISOString(),
      lookaheadDays,
    }, 'Running configured sport schedule sync');
    await this.runScheduleSync(sport, from, to);
  }

  private async runConfiguredSportFieldSync(sport: Sport): Promise<void> {
    const config = await this.getSportConfig(sport);
    if (!config.eventParticipants.enabled) {
      this.logger?.debug({ sport }, 'Skipping scheduled participant sync because it is disabled');
      return;
    }

    const now = this.getNow();
    const leadDays = config.eventParticipants.leadDaysBeforeStart ?? config.eventSchedule.lookaheadDays ?? 7;
    const from = now;
    const to = addDays(now, leadDays);
    this.logger?.debug({
      sport,
      from: from.toISOString(),
      to: to.toISOString(),
      leadDays,
    }, 'Running configured sport participant sync');
    await this.runFieldSync(sport, from, to);
  }

  private async runConfiguredSportRankingSync(sport: Sport): Promise<void> {
    const config = await this.getSportConfig(sport);
    if (!config.participantRankings.enabled) {
      this.logger?.debug({ sport }, 'Skipping scheduled ranking sync because it is disabled');
      return;
    }

    this.logger?.debug({ sport }, 'Running configured sport ranking sync');
    await this.runRankingSync(sport);
  }

  private async runConfiguredEventSyncSweep(
    sport: Sport,
    feed: 'EVENTLIVESCORES' | 'EVENTRESULTS',
  ): Promise<void> {
    const config = await this.getSportConfig(sport);
    const policy = feed === 'EVENTLIVESCORES' ? config.eventLiveScores : config.eventResults;
    if (!policy.enabled) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync sweep because it is disabled');
      return;
    }

    const eventReader = this.options.eventReader;
    if (!eventReader) {
      this.logger?.debug({ sport, feed }, 'Skipping scheduled event sync because no event reader is configured');
      return;
    }

    const eventIds = await eventReader.listEventIdsForFeed({
      sport,
      feed,
      now: this.getNow(),
    });

    this.logger?.debug({
      sport,
      feed,
      eventCount: eventIds.length,
      eventIds,
    }, 'Resolved scheduled event sync candidates');

    for (const eventId of eventIds) {
      if (feed === 'EVENTLIVESCORES') {
        await this.pollLiveScores(sport, eventId);
      } else {
        await this.fetchEventResults(sport, eventId);
      }
    }
  }

  private async syncAllFields(): Promise<void> {
    this.logger?.debug('Running startup/interval participant sync sweep');
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      try {
        await this.runFieldSync(sport);
      } catch {
        this.logger?.error({ sport }, 'Participant sync sweep failed for sport');
      }
    }
  }

  private async syncAllRankings(): Promise<void> {
    this.logger?.debug('Running startup/interval ranking sync sweep');
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      try {
        await this.runRankingSync(sport);
      } catch {
        this.logger?.error({ sport }, 'Ranking sync sweep failed for sport');
      }
    }
  }

  private async runScheduleSync(
    sport: Sport,
    from?: Date,
    to?: Date,
  ): Promise<IngestionJobRecord> {
    const dateRange = resolveDateRange(from, to);
    this.logger?.debug({
      sport,
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    }, 'Running schedule sync for sport');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport }, 'No provider registered for schedule sync');
      return createFailedJob('EVENT_SCHEDULE_SYNC', 'none', sport, 'No provider registered');
    }

    return this.runJob('EVENT_SCHEDULE_SYNC', provider.providerId, sport, async () => {
      const events = await provider.getUpcomingEvents(sport, dateRange);
      this.logger?.debug({
        sport,
        providerId: provider.providerId,
        eventsReturned: events.length,
        eventSample: events.slice(0, 10).map(toEventSample),
      }, 'Provider returned upcoming events');
      if (events.length === 0) {
        this.logger?.warn({
          sport,
          providerId: provider.providerId,
          from: dateRange.from.toISOString(),
          to: dateRange.to.toISOString(),
        }, 'Provider returned no upcoming events for schedule sync');
      }
      await this.callbacks.onEvents(events);
      this.logger?.info({
        sport,
        providerId: provider.providerId,
        eventsProcessed: events.length,
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
      }, 'Completed schedule sync for sport');
      return events.length;
    });
  }

  private async runFieldSync(
    sport: Sport,
    from?: Date,
    to?: Date,
  ): Promise<IngestionJobRecord> {
    const dateRange = resolveDateRange(from, to);
    this.logger?.debug({
      sport,
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    }, 'Running participant sync for sport');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport }, 'No provider registered for participant sync');
      return createFailedJob('EVENT_PARTICIPANTS_SYNC', 'none', sport, 'No provider registered');
    }

    return this.runJob('EVENT_PARTICIPANTS_SYNC', provider.providerId, sport, async () => {
      const events = await provider.getUpcomingEvents(sport, dateRange);
      this.logger?.debug({
        sport,
        providerId: provider.providerId,
        eventsDiscovered: events.length,
        eventSample: events.slice(0, 10).map(toEventSample),
      }, 'Provider returned participant sync event candidates');
      if (events.length === 0) {
        this.logger?.warn({
          sport,
          providerId: provider.providerId,
          from: dateRange.from.toISOString(),
          to: dateRange.to.toISOString(),
        }, 'Provider returned no event candidates for participant sync');
      }
      let hydratedCount = 0;
      let participantsReturned = 0;

      for (const event of events) {
        this.logger?.debug({
          sport,
          providerId: provider.providerId,
          eventExternalId: event.externalId,
          eventName: event.name,
          startDate: event.startDate.toISOString(),
        }, 'Fetching event detail for participant sync');
        const detail = await provider.getEventDetails(event.externalId);
        if (!detail) {
          this.logger?.warn({
            sport,
            providerId: provider.providerId,
            eventExternalId: event.externalId,
          }, 'Provider returned no event detail for participant sync candidate');
          continue;
        }

        participantsReturned += detail.participants.length;
        this.logger?.debug({
          sport,
          providerId: provider.providerId,
          eventExternalId: detail.externalId,
          participantCount: detail.participants.length,
        }, 'Provider returned event detail for participant sync');
        await this.callbacks.onEventDetail(detail);
        hydratedCount += 1;
      }

      this.logger?.info({
        sport,
        providerId: provider.providerId,
        eventsDiscovered: events.length,
        eventsHydrated: hydratedCount,
        participantsReturned,
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
      }, 'Completed participant sync for sport');
      return hydratedCount;
    });
  }

  private async runEventFieldSync(
    sport: Sport,
    eventId: string,
  ): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId }, 'Running participant sync for event');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for event participant sync');
      return createFailedJob('EVENT_PARTICIPANTS_SYNC', 'none', sport, 'No provider registered', eventId);
    }

    return this.runJob('EVENT_PARTICIPANTS_SYNC', provider.providerId, sport, async () => {
      const detail = await provider.getEventDetails(eventId);
      if (!detail) {
        this.logger?.warn({ sport, eventId, providerId: provider.providerId }, 'Provider returned no event detail for participant sync');
        return 0;
      }

      await this.callbacks.onEventDetail(detail);
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        participantCount: detail.participants.length,
      }, 'Completed participant sync for event');
      return detail.participants.length;
    }, eventId);
  }

  private async runRankingSync(sport: Sport): Promise<IngestionJobRecord> {
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport }, 'No provider registered for ranking sync');
      return createFailedJob('PARTICIPANT_RANKINGS_SYNC', 'none', sport, 'No provider registered');
    }

    return this.runJob('PARTICIPANT_RANKINGS_SYNC', provider.providerId, sport, async () => {
      const rankings = await provider.getRankings(sport, 'default');
      this.logger?.debug({
        sport,
        providerId: provider.providerId,
        rankingsReturned: rankings.length,
      }, 'Provider returned rankings');
      await this.callbacks.onRankings(rankings);
      this.logger?.info({
        sport,
        providerId: provider.providerId,
        rankingsProcessed: rankings.length,
      }, 'Completed ranking sync for sport');
      return rankings.length;
    });
  }

  private async runJob(
    jobType: JobType,
    providerId: string,
    sport: Sport,
    work: () => Promise<number>,
    eventExternalId?: string,
  ): Promise<IngestionJobRecord> {
    const job: IngestionJobRecord = {
      jobType,
      providerId,
      sport,
      eventExternalId,
      status: 'RUNNING',
      startedAt: new Date(),
      recordsProcessed: 0,
      errors: 0,
      errorLog: [],
    };

    try {
      this.logger?.debug({
        jobType,
        providerId,
        sport,
        eventExternalId: eventExternalId ?? null,
        startedAt: job.startedAt?.toISOString() ?? null,
      }, 'Ingestion job started');
      job.recordsProcessed = await work();
      job.status = 'COMPLETED';
      job.completedAt = new Date();
    } catch (err) {
      this.logger?.error({
        jobType,
        providerId,
        sport,
        eventExternalId,
        error: err,
      }, 'Ingestion job failed');
      job.status = 'FAILED';
      job.errors = 1;
      job.errorLog = [{ error: err instanceof Error ? err.message : String(err), at: new Date() }];
      job.completedAt = new Date();
    }

    await this.callbacks.onJobComplete(job);
    this.logger?.info({
      ...toJobLogPayload(job),
      durationMs: job.completedAt && job.startedAt
        ? job.completedAt.getTime() - job.startedAt.getTime()
        : null,
    }, 'Ingestion job completed');
    return job;
  }

  private startRecurringLoop(
    label: string,
    runner: () => Promise<void>,
    resolveDelayMs: () => Promise<number>,
  ): void {
    const tick = async () => {
      if (!this.running) {
        return;
      }

      try {
        this.logger?.debug({ label }, 'Recurring ingestion loop tick started');
        await runner();
      } catch (error) {
        this.logger?.error({ error, label }, 'Recurring ingestion loop failed');
      }

      const delayMs = await this.safeResolveDelayMs(resolveDelayMs);
      if (!this.running) {
        return;
      }

      const timer = setTimeout(() => {
        void tick();
      }, delayMs);
      this.timers.push(timer);
      this.logger?.debug({ label, delayMs }, 'Recurring ingestion loop scheduled next tick');
    };

    void tick();
  }

  private async getGlobalDelayMs(
    feed: keyof Pick<IngestionScheduleConfig, 'healthCheck'>,
  ): Promise<number> {
    const config = await this.getGlobalConfig();
    return toDelayMs(config[feed]);
  }

  private async getSportDelayMs(
    sport: Sport,
    feed: keyof Omit<IngestionScheduleConfig, 'perSportOverrides'>,
  ): Promise<number> {
    const config = await this.getSportConfig(sport);
    return toDelayMs(config[feed]);
  }

  private async getGlobalConfig(): Promise<IngestionScheduleConfig> {
    if (!this.options.configReader) {
      return defaultIngestionScheduleConfig();
    }

    return this.options.configReader.getConfig();
  }

  private async getSportConfig(sport: Sport): Promise<IngestionScheduleConfig> {
    if (!this.options.configReader) {
      return defaultIngestionScheduleConfig();
    }

    return this.options.configReader.getPerSportConfig(sport);
  }

  private getNow(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async safeResolveDelayMs(resolveDelayMs: () => Promise<number>): Promise<number> {
    try {
      return await resolveDelayMs();
    } catch (error) {
      this.logger?.error({ error }, 'Falling back to config recheck delay because policy resolution failed');
      return CONFIG_RECHECK_MS;
    }
  }
}

function resolveDateRange(from?: Date, to?: Date): { from: Date; to: Date } {
  const resolvedFrom = from ?? new Date();
  const resolvedTo = to ?? new Date(resolvedFrom.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    from: resolvedFrom,
    to: resolvedTo,
  };
}

function createFailedJob(
  jobType: JobType,
  providerId: string,
  sport: Sport,
  error: string,
  eventExternalId?: string,
): IngestionJobRecord {
  return {
    jobType,
    providerId,
    sport,
    eventExternalId,
    status: 'FAILED',
    startedAt: new Date(),
    completedAt: new Date(),
    recordsProcessed: 0,
    errors: 1,
    errorLog: [{ error, at: new Date() }],
  };
}

function dedupe<T extends string>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

function toEventSample(event: SportEvent): Record<string, unknown> {
  return {
    externalId: event.externalId,
    providerId: event.providerId,
    name: event.name,
    status: event.status,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    participantCount: event.participantCount ?? null,
    releaseAt: event.metadata.releaseAt ?? null,
    fieldLocksAt: event.metadata.fieldLocksAt ?? null,
  };
}

function toJobLogPayload(job: IngestionJobRecord): Record<string, unknown> {
  return {
    jobType: job.jobType,
    providerId: job.providerId,
    sport: job.sport,
    eventExternalId: job.eventExternalId ?? null,
    status: job.status,
    recordsProcessed: job.recordsProcessed,
    errors: job.errors,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

const CONFIG_RECHECK_MS = 60 * 1000;

function defaultIngestionScheduleConfig(): IngestionScheduleConfig {
    return {
      healthCheck: {
        enabled: true,
        intervalMinutes: 5,
      },
    eventSchedule: {
        enabled: true,
        intervalMinutes: 360,
        lookaheadDays: 30,
      },
    eventParticipants: {
        enabled: true,
        intervalMinutes: 720,
        leadDaysBeforeStart: 7,
      },
    participantRankings: {
        enabled: true,
        intervalMinutes: 1440,
      },
    eventLiveScores: {
        enabled: true,
        intervalSeconds: 30,
      },
    eventResults: {
        enabled: true,
        intervalMinutes: 30,
      },
    perSportOverrides: {},
  };
}

function toDelayMs(policy: IngestionScheduleConfig[keyof Omit<IngestionScheduleConfig, 'perSportOverrides'>]): number {
  if (!policy.enabled) {
    return CONFIG_RECHECK_MS;
  }

  if (policy.intervalSeconds) {
    return policy.intervalSeconds * 1000;
  }

  if (policy.intervalMinutes) {
    return policy.intervalMinutes * 60 * 1000;
  }

  return CONFIG_RECHECK_MS;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

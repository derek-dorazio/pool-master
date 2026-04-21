/**
 * IngestionScheduler — orchestrates periodic data polling from providers.
 *
 * Schedules jobs for:
 * - Event schedule sync (daily)
 * - Participant roster sync (daily)
 * - Ranking updates (daily)
 * - Live score polling (every 30s during active events)
 * - Provider health checks (every 5 min)
 */

import type { Sport } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderRegistry } from './provider-registry';
import type {
  SportEvent,
  ProviderParticipant,
  ProviderRanking,
  ProviderStatEvent,
} from './provider-interface';

export type JobType =
  | 'SCHEDULE_SYNC'
  | 'PARTICIPANT_SYNC'
  | 'RANKING_SYNC'
  | 'LIVE_SCORES'
  | 'EVENT_RESULTS'
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

export interface IngestionCallbacks {
  onEvents(events: SportEvent[]): Promise<void>;
  onParticipants(participants: ProviderParticipant[]): Promise<void>;
  onRankings(rankings: ProviderRanking[]): Promise<void>;
  onLiveScores(scores: ProviderStatEvent[]): Promise<void>;
  onJobComplete(job: IngestionJobRecord): Promise<void>;
}

export class IngestionScheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly callbacks: IngestionCallbacks,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /** Starts all scheduled ingestion jobs. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger?.debug('Starting ingestion scheduler');

    // Health checks every 5 minutes
    this.timers.push(setInterval(() => this.runHealthChecks(), 5 * 60 * 1000));

    // Schedule sync every 6 hours
    this.timers.push(setInterval(() => this.syncAllSchedules(), 6 * 60 * 60 * 1000));

    // Participant sync every 12 hours
    this.timers.push(setInterval(() => this.syncAllParticipants(), 12 * 60 * 60 * 1000));

    // Ranking sync every 24 hours
    this.timers.push(setInterval(() => this.syncAllRankings(), 24 * 60 * 60 * 1000));

    // Run initial sync on startup
    this.runHealthChecks();
    this.syncAllSchedules();
    this.syncAllParticipants();
    this.syncAllRankings();
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

  /** Runs a one-off sync for a specific sport. */
  async syncSport(sport: Sport): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport }, 'Running schedule sync for sport');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport }, 'No provider registered for schedule sync');
      return createFailedJob('SCHEDULE_SYNC', 'none', sport, 'No provider registered');
    }

    return this.runJob('SCHEDULE_SYNC', provider.providerId, sport, async () => {
      const now = new Date();
      const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const events = await provider.getUpcomingEvents(sport, { from: now, to: twoWeeksOut });
      await this.callbacks.onEvents(events);
      this.logger?.info({
        sport,
        providerId: provider.providerId,
        eventsProcessed: events.length,
      }, 'Completed schedule sync for sport');
      return events.length;
    });
  }

  /** Polls live scores for a specific event. */
  async pollLiveScores(sport: Sport, eventId: string): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId }, 'Polling live scores for event');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for live score polling');
      return createFailedJob('LIVE_SCORES', 'none', sport, 'No provider registered');
    }

    return this.runJob('LIVE_SCORES', provider.providerId, sport, async () => {
      const scores = await provider.getLiveScores(eventId);
      await this.callbacks.onLiveScores(scores);
      this.logger?.info({
        sport,
        eventId,
        providerId: provider.providerId,
        scoresProcessed: scores.length,
      }, 'Completed live score poll');
      return scores.length;
    });
  }

  /** Fetches final results for a completed event. */
  async fetchEventResults(sport: Sport, eventId: string): Promise<IngestionJobRecord> {
    this.logger?.debug({ sport, eventId }, 'Fetching event results');
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      this.logger?.warn({ sport, eventId }, 'No provider registered for event results fetch');
      return createFailedJob('EVENT_RESULTS', 'none', sport, 'No provider registered');
    }

    return this.runJob('EVENT_RESULTS', provider.providerId, sport, async () => {
      const results = await provider.getEventResults(eventId);
      if (results) {
        // Convert results to stat events for scoring
        const statEvents: ProviderStatEvent[] = results.results.map((r) => ({
          id: `${eventId}-${r.participantExternalId}-result`,
          eventExternalId: eventId,
          participantExternalId: r.participantExternalId,
          statKey: 'FINISH_POSITION',
          statValue: r.finishPosition,
          timestamp: new Date(),
          isCorrection: false,
          providerId: provider.providerId,
        }));
        await this.callbacks.onLiveScores(statEvents);
        this.logger?.info({
          sport,
          eventId,
          providerId: provider.providerId,
          resultsProcessed: results.results.length,
        }, 'Completed event results fetch');
        return results.results.length;
      }
      this.logger?.warn({ sport, eventId, providerId: provider.providerId }, 'Provider returned no event results');
      return 0;
    });
  }

  // --- Private scheduling methods ---

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
        await this.syncSport(sport);
      } catch {
        // Individual sport failures don't block others
        this.logger?.error({ sport }, 'Schedule sync sweep failed for sport');
      }
    }
  }

  private async syncAllParticipants(): Promise<void> {
    this.logger?.debug('Running startup/interval participant sync sweep');
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      const provider = this.registry.getProvider(sport);
      if (!provider) {
        this.logger?.warn({ sport }, 'No provider registered for participant sync');
        continue;
      }

      try {
        await this.runJob('PARTICIPANT_SYNC', provider.providerId, sport, async () => {
          const participants = await provider.getParticipants(sport);
          await this.callbacks.onParticipants(participants);
          this.logger?.info({
            sport,
            providerId: provider.providerId,
            participantsProcessed: participants.length,
          }, 'Completed participant sync for sport');
          return participants.length;
        });
      } catch {
        // Continue with other sports
        this.logger?.error({ sport, providerId: provider.providerId }, 'Participant sync sweep failed for sport');
      }
    }
  }

  private async syncAllRankings(): Promise<void> {
    this.logger?.debug('Running startup/interval ranking sync sweep');
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      const provider = this.registry.getProvider(sport);
      if (!provider) {
        this.logger?.warn({ sport }, 'No provider registered for ranking sync');
        continue;
      }

      try {
        await this.runJob('RANKING_SYNC', provider.providerId, sport, async () => {
          const rankings = await provider.getRankings(sport, 'default');
          await this.callbacks.onRankings(rankings);
          this.logger?.info({
            sport,
            providerId: provider.providerId,
            rankingsProcessed: rankings.length,
          }, 'Completed ranking sync for sport');
          return rankings.length;
        });
      } catch {
        // Continue with other sports
        this.logger?.error({ sport, providerId: provider.providerId }, 'Ranking sync sweep failed for sport');
      }
    }
  }

  private async runJob(
    jobType: JobType,
    providerId: string,
    sport: Sport,
    work: () => Promise<number>,
  ): Promise<IngestionJobRecord> {
    const job: IngestionJobRecord = {
      jobType,
      providerId,
      sport,
      status: 'RUNNING',
      startedAt: new Date(),
      recordsProcessed: 0,
      errors: 0,
      errorLog: [],
    };

    try {
      job.recordsProcessed = await work();
      job.status = 'COMPLETED';
      job.completedAt = new Date();
    } catch (err) {
      this.logger?.error({
        jobType,
        providerId,
        sport,
        error: err,
      }, 'Ingestion job failed');
      job.status = 'FAILED';
      job.errors = 1;
      job.errorLog = [{ error: err instanceof Error ? err.message : String(err), at: new Date() }];
      job.completedAt = new Date();
    }

    await this.callbacks.onJobComplete(job);
    return job;
  }
}

function createFailedJob(
  jobType: JobType,
  providerId: string,
  sport: Sport,
  error: string,
): IngestionJobRecord {
  return {
    jobType,
    providerId,
    sport,
    status: 'FAILED',
    startedAt: new Date(),
    completedAt: new Date(),
    recordsProcessed: 0,
    errors: 1,
    errorLog: [{ error, at: new Date() }],
  };
}

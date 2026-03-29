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
  ) {}

  /** Starts all scheduled ingestion jobs. */
  start(): void {
    if (this.running) return;
    this.running = true;

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
  }

  /** Stops all scheduled jobs. */
  stop(): void {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }

  /** Runs a one-off sync for a specific sport. */
  async syncSport(sport: Sport): Promise<IngestionJobRecord> {
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      return createFailedJob('SCHEDULE_SYNC', 'none', sport, 'No provider registered');
    }

    return this.runJob('SCHEDULE_SYNC', provider.providerId, sport, async () => {
      const now = new Date();
      const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const events = await provider.getUpcomingEvents(sport, { from: now, to: twoWeeksOut });
      await this.callbacks.onEvents(events);
      return events.length;
    });
  }

  /** Polls live scores for a specific event. */
  async pollLiveScores(sport: Sport, eventId: string): Promise<IngestionJobRecord> {
    const provider = this.registry.getProvider(sport);
    if (!provider) {
      return createFailedJob('LIVE_SCORES', 'none', sport, 'No provider registered');
    }

    return this.runJob('LIVE_SCORES', provider.providerId, sport, async () => {
      const scores = await provider.getLiveScores(eventId);
      await this.callbacks.onLiveScores(scores);
      return scores.length;
    });
  }

  /** Fetches final results for a completed event. */
  async fetchEventResults(sport: Sport, eventId: string): Promise<IngestionJobRecord> {
    const provider = this.registry.getProvider(sport);
    if (!provider) {
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
        return results.results.length;
      }
      return 0;
    });
  }

  // --- Private scheduling methods ---

  private async runHealthChecks(): Promise<void> {
    const providers = this.registry.getAllProviders();
    for (const provider of providers) {
      try {
        const health = await provider.healthCheck();
        this.registry.updateHealth(provider.providerId, health);
      } catch {
        this.registry.updateHealth(provider.providerId, {
          providerId: provider.providerId,
          status: 'DOWN',
          errorRateLastHour: 1,
          latencyMsP95: 0,
          message: 'Health check threw exception',
        });
      }
    }
  }

  private async syncAllSchedules(): Promise<void> {
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      try {
        await this.syncSport(sport);
      } catch {
        // Individual sport failures don't block others
      }
    }
  }

  private async syncAllParticipants(): Promise<void> {
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      const provider = this.registry.getProvider(sport);
      if (!provider) continue;

      try {
        await this.runJob('PARTICIPANT_SYNC', provider.providerId, sport, async () => {
          const participants = await provider.getParticipants(sport);
          await this.callbacks.onParticipants(participants);
          return participants.length;
        });
      } catch {
        // Continue with other sports
      }
    }
  }

  private async syncAllRankings(): Promise<void> {
    const sports = this.registry.getSupportedSports();
    for (const sport of sports) {
      const provider = this.registry.getProvider(sport);
      if (!provider) continue;

      try {
        await this.runJob('RANKING_SYNC', provider.providerId, sport, async () => {
          const rankings = await provider.getRankings(sport, 'default');
          await this.callbacks.onRankings(rankings);
          return rankings.length;
        });
      } catch {
        // Continue with other sports
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

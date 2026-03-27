/**
 * ProviderService — business logic for admin sports data provider management.
 *
 * Provides provider health monitoring, ingestion stats, configuration
 * management, re-ingestion triggers, and participant mapping.
 * Uses mock data — will be replaced with real provider registry integration.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface ProviderSummary {
  providerId: string;
  name: string;
  status: ProviderHealthStatus;
  errorRate: number;
  latencyMs: number;
  lastEventAt: Date;
  sports: string[];
}

export interface ProviderDetail {
  providerId: string;
  name: string;
  status: ProviderHealthStatus;
  errorRate: number;
  latencyMs: number;
  lastEventAt: Date;
  sports: string[];
  config: ProviderConfig;
  ingestionStats: SportIngestionStat[];
}

export interface ProviderConfig {
  apiKey: string;
  apiSecret?: string;
  webhookSecret?: string;
  webhookUrl: string;
  webhookEvents: string[];
  degradedErrorRate: number;
  downErrorRate: number;
  maxLatencyMs: number;
  monthlyBudgetUsd: number;
  currentMonthSpendUsd: number;
  budgetAlertThreshold: number;
}

export interface SportIngestionStat {
  sport: string;
  providerId: string;
  lastPollAt: Date;
  lastEventReceivedAt: Date;
  eventsToday: number;
  errorsToday: number;
  activeEventCount: number;
  contestsDepending: number;
}

export interface IngestionJob {
  id: string;
  providerId: string;
  sport: string;
  eventId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: Date;
  completedAt?: Date;
  recordsProcessed: number;
  errors: number;
}

export interface IngestionError {
  providerId: string;
  errorType: string;
  message: string;
  occurredAt: Date;
  eventId?: string;
}

export interface IngestionDashboard {
  sportProviderStatus: SportIngestionStat[];
  recentErrors: IngestionError[];
  activeJobs: IngestionJob[];
  recentCompletedJobs: IngestionJob[];
}

export interface UnmappedParticipant {
  id: string;
  externalId: string;
  providerId: string;
  providerName: string;
  externalName: string;
  sport: string;
  firstSeenAt: Date;
  eventCount: number;
}

export interface HealthCheckResult {
  providerId: string;
  name: string;
  status: ProviderHealthStatus;
  latencyMs: number;
  checkedAt: Date;
  details: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProviderNotFoundError extends Error {
  constructor(providerId: string) {
    super(`Provider not found: ${providerId}`);
    this.name = 'ProviderNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const now = new Date();

function minutesAgo(m: number): Date {
  return new Date(now.getTime() - m * 60_000);
}

const MOCK_PROVIDERS: Map<string, ProviderDetail> = new Map([
  ['sportsdataio', {
    providerId: 'sportsdataio',
    name: 'SportsDataIO',
    status: 'HEALTHY' as ProviderHealthStatus,
    errorRate: 0.2,
    latencyMs: 245,
    lastEventAt: minutesAgo(0.5),
    sports: ['NFL', 'NBA', 'NCAA'],
    config: {
      apiKey: 'sd-****-****-7a3f',
      webhookUrl: 'https://api.poolmaster.io/webhooks/sportsdataio',
      webhookEvents: ['score.update', 'game.start', 'game.end', 'injury.update'],
      degradedErrorRate: 5,
      downErrorRate: 20,
      maxLatencyMs: 5000,
      monthlyBudgetUsd: 2500,
      currentMonthSpendUsd: 1840,
      budgetAlertThreshold: 0.8,
    },
    ingestionStats: [
      {
        sport: 'NFL',
        providerId: 'sportsdataio',
        lastPollAt: minutesAgo(1),
        lastEventReceivedAt: minutesAgo(0.5),
        eventsToday: 1245,
        errorsToday: 3,
        activeEventCount: 8,
        contestsDepending: 42,
      },
      {
        sport: 'NBA',
        providerId: 'sportsdataio',
        lastPollAt: minutesAgo(1),
        lastEventReceivedAt: minutesAgo(2),
        eventsToday: 890,
        errorsToday: 1,
        activeEventCount: 12,
        contestsDepending: 31,
      },
    ],
  }],
  ['sportradar', {
    providerId: 'sportradar',
    name: 'Sportradar',
    status: 'HEALTHY' as ProviderHealthStatus,
    errorRate: 0.1,
    latencyMs: 180,
    lastEventAt: minutesAgo(1),
    sports: ['NFL', 'NBA', 'NCAA', 'Soccer'],
    config: {
      apiKey: 'sr-****-****-9b2e',
      apiSecret: 'sr-sec-****',
      webhookUrl: 'https://api.poolmaster.io/webhooks/sportradar',
      webhookEvents: ['score.live', 'game.status', 'player.stats'],
      degradedErrorRate: 5,
      downErrorRate: 20,
      maxLatencyMs: 3000,
      monthlyBudgetUsd: 4000,
      currentMonthSpendUsd: 2950,
      budgetAlertThreshold: 0.8,
    },
    ingestionStats: [
      {
        sport: 'Soccer',
        providerId: 'sportradar',
        lastPollAt: minutesAgo(2),
        lastEventReceivedAt: minutesAgo(3),
        eventsToday: 2100,
        errorsToday: 2,
        activeEventCount: 18,
        contestsDepending: 15,
      },
    ],
  }],
  ['equibase', {
    providerId: 'equibase',
    name: 'Equibase',
    status: 'DEGRADED' as ProviderHealthStatus,
    errorRate: 8.5,
    latencyMs: 2100,
    lastEventAt: minutesAgo(15),
    sports: ['Horse Racing'],
    config: {
      apiKey: 'eq-****-****-4d1c',
      webhookUrl: 'https://api.poolmaster.io/webhooks/equibase',
      webhookEvents: ['race.result', 'race.scratches', 'odds.update'],
      degradedErrorRate: 5,
      downErrorRate: 20,
      maxLatencyMs: 5000,
      monthlyBudgetUsd: 1500,
      currentMonthSpendUsd: 1100,
      budgetAlertThreshold: 0.8,
    },
    ingestionStats: [
      {
        sport: 'Horse Racing',
        providerId: 'equibase',
        lastPollAt: minutesAgo(5),
        lastEventReceivedAt: minutesAgo(15),
        eventsToday: 320,
        errorsToday: 28,
        activeEventCount: 4,
        contestsDepending: 8,
      },
    ],
  }],
  ['theoddsapi', {
    providerId: 'theoddsapi',
    name: 'TheOddsAPI',
    status: 'HEALTHY' as ProviderHealthStatus,
    errorRate: 0.0,
    latencyMs: 120,
    lastEventAt: minutesAgo(5),
    sports: ['NFL', 'NBA', 'NCAA', 'Soccer', 'Tennis'],
    config: {
      apiKey: 'oa-****-****-8e5f',
      webhookUrl: 'https://api.poolmaster.io/webhooks/theoddsapi',
      webhookEvents: ['odds.update', 'line.movement'],
      degradedErrorRate: 5,
      downErrorRate: 20,
      maxLatencyMs: 3000,
      monthlyBudgetUsd: 800,
      currentMonthSpendUsd: 520,
      budgetAlertThreshold: 0.8,
    },
    ingestionStats: [
      {
        sport: 'NFL',
        providerId: 'theoddsapi',
        lastPollAt: minutesAgo(5),
        lastEventReceivedAt: minutesAgo(5),
        eventsToday: 4500,
        errorsToday: 0,
        activeEventCount: 22,
        contestsDepending: 0,
      },
    ],
  }],
  ['espn', {
    providerId: 'espn',
    name: 'ESPN',
    status: 'HEALTHY' as ProviderHealthStatus,
    errorRate: 0.3,
    latencyMs: 310,
    lastEventAt: minutesAgo(2),
    sports: ['NFL', 'NBA', 'NCAA', 'Golf', 'Tennis'],
    config: {
      apiKey: 'espn-****-****-2c7a',
      webhookUrl: 'https://api.poolmaster.io/webhooks/espn',
      webhookEvents: ['score.update', 'schedule.change'],
      degradedErrorRate: 5,
      downErrorRate: 20,
      maxLatencyMs: 5000,
      monthlyBudgetUsd: 3000,
      currentMonthSpendUsd: 2100,
      budgetAlertThreshold: 0.8,
    },
    ingestionStats: [
      {
        sport: 'Golf',
        providerId: 'espn',
        lastPollAt: minutesAgo(2),
        lastEventReceivedAt: minutesAgo(2),
        eventsToday: 650,
        errorsToday: 2,
        activeEventCount: 3,
        contestsDepending: 12,
      },
    ],
  }],
  ['openf1', {
    providerId: 'openf1',
    name: 'OpenF1',
    status: 'HEALTHY' as ProviderHealthStatus,
    errorRate: 0.0,
    latencyMs: 95,
    lastEventAt: minutesAgo(30),
    sports: ['F1'],
    config: {
      apiKey: 'of1-****-****-6b9d',
      webhookUrl: 'https://api.poolmaster.io/webhooks/openf1',
      webhookEvents: ['session.update', 'lap.data', 'position.change'],
      degradedErrorRate: 5,
      downErrorRate: 20,
      maxLatencyMs: 3000,
      monthlyBudgetUsd: 500,
      currentMonthSpendUsd: 180,
      budgetAlertThreshold: 0.8,
    },
    ingestionStats: [
      {
        sport: 'F1',
        providerId: 'openf1',
        lastPollAt: minutesAgo(10),
        lastEventReceivedAt: minutesAgo(30),
        eventsToday: 120,
        errorsToday: 0,
        activeEventCount: 1,
        contestsDepending: 5,
      },
    ],
  }],
]);

const MOCK_UNMAPPED: UnmappedParticipant[] = [
  {
    id: 'unmap-001',
    externalId: 'ext-player-99821',
    providerId: 'sportsdataio',
    providerName: 'SportsDataIO',
    externalName: 'J. Rodriguez III',
    sport: 'NFL',
    firstSeenAt: minutesAgo(120),
    eventCount: 3,
  },
  {
    id: 'unmap-002',
    externalId: 'ext-horse-4412',
    providerId: 'equibase',
    providerName: 'Equibase',
    externalName: 'Midnight Thunder',
    sport: 'Horse Racing',
    firstSeenAt: minutesAgo(60),
    eventCount: 1,
  },
  {
    id: 'unmap-003',
    externalId: 'ext-driver-55',
    providerId: 'openf1',
    providerName: 'OpenF1',
    externalName: 'A. Antonelli',
    sport: 'F1',
    firstSeenAt: minutesAgo(45),
    eventCount: 2,
  },
];

const MOCK_ACTIVE_JOBS: IngestionJob[] = [
  {
    id: 'job-001',
    providerId: 'sportsdataio',
    sport: 'NFL',
    eventId: 'nfl-game-2026-week12-001',
    status: 'RUNNING',
    startedAt: minutesAgo(2),
    recordsProcessed: 1240,
    errors: 0,
  },
  {
    id: 'job-002',
    providerId: 'sportradar',
    sport: 'Soccer',
    eventId: 'epl-match-2026-gw28-003',
    status: 'RUNNING',
    startedAt: minutesAgo(1),
    recordsProcessed: 580,
    errors: 0,
  },
];

const MOCK_RECENT_COMPLETED: IngestionJob[] = [
  {
    id: 'job-003',
    providerId: 'espn',
    sport: 'Golf',
    eventId: 'pga-masters-2026-rd2',
    status: 'COMPLETED',
    startedAt: minutesAgo(30),
    completedAt: minutesAgo(25),
    recordsProcessed: 4800,
    errors: 0,
  },
  {
    id: 'job-004',
    providerId: 'equibase',
    sport: 'Horse Racing',
    eventId: 'ky-derby-2026-race5',
    status: 'FAILED',
    startedAt: minutesAgo(20),
    completedAt: minutesAgo(18),
    recordsProcessed: 120,
    errors: 8,
  },
];

const MOCK_RECENT_ERRORS: IngestionError[] = [
  {
    providerId: 'equibase',
    errorType: 'TIMEOUT',
    message: 'Request timed out after 5000ms fetching race results',
    occurredAt: minutesAgo(15),
    eventId: 'ky-derby-2026-race5',
  },
  {
    providerId: 'equibase',
    errorType: 'PARSE_ERROR',
    message: 'Unexpected field "scratched_at" in race result payload',
    occurredAt: minutesAgo(12),
    eventId: 'ky-derby-2026-race5',
  },
  {
    providerId: 'sportsdataio',
    errorType: 'RATE_LIMIT',
    message: 'Rate limit exceeded — 429 response from /v3/nfl/scores',
    occurredAt: minutesAgo(45),
  },
];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProviderService {
  /**
   * Returns all providers with health status summaries.
   */
  async listProviders(): Promise<ProviderSummary[]> {
    const summaries: ProviderSummary[] = [];
    for (const p of MOCK_PROVIDERS.values()) {
      summaries.push({
        providerId: p.providerId,
        name: p.name,
        status: p.status,
        errorRate: p.errorRate,
        latencyMs: p.latencyMs,
        lastEventAt: p.lastEventAt,
        sports: p.sports,
      });
    }
    return summaries;
  }

  /**
   * Returns full detail for a single provider including config and ingestion stats.
   */
  async getProviderDetail(providerId: string): Promise<ProviderDetail> {
    const provider = MOCK_PROVIDERS.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }
    return provider;
  }

  /**
   * Updates provider configuration (thresholds, credentials).
   */
  async updateProviderConfig(
    providerId: string,
    updates: Partial<ProviderConfig>,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<ProviderConfig> {
    const provider = MOCK_PROVIDERS.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }

    const beforeConfig = { ...provider.config };
    Object.assign(provider.config, updates);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'sportsdata.update_config',
      resourceType: 'PROVIDER',
      resourceId: providerId,
      description: `Updated provider config for ${provider.name}`,
      beforeState: beforeConfig as unknown as Record<string, unknown>,
      afterState: provider.config as unknown as Record<string, unknown>,
    });

    return provider.config;
  }

  /**
   * Triggers a manual health check for a provider.
   */
  async triggerHealthCheck(
    providerId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<HealthCheckResult> {
    const provider = MOCK_PROVIDERS.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }

    // Mock health check result
    const result: HealthCheckResult = {
      providerId,
      name: provider.name,
      status: provider.status,
      latencyMs: provider.latencyMs + Math.floor(Math.random() * 50),
      checkedAt: new Date(),
      details: provider.status === 'HEALTHY'
        ? 'All endpoints responding normally'
        : `Elevated error rate: ${provider.errorRate}%, latency: ${provider.latencyMs}ms`,
    };

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'sportsdata.health_check',
      resourceType: 'PROVIDER',
      resourceId: providerId,
      description: `Manual health check for ${provider.name} — status: ${result.status}`,
      afterState: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  /**
   * Returns the ingestion monitoring dashboard with jobs, errors, and throughput.
   */
  async getIngestionDashboard(): Promise<IngestionDashboard> {
    const sportProviderStatus: SportIngestionStat[] = [];
    for (const p of MOCK_PROVIDERS.values()) {
      sportProviderStatus.push(...p.ingestionStats);
    }

    return {
      sportProviderStatus,
      recentErrors: MOCK_RECENT_ERRORS,
      activeJobs: MOCK_ACTIVE_JOBS,
      recentCompletedJobs: MOCK_RECENT_COMPLETED,
    };
  }

  /**
   * Triggers re-ingestion for a specific event from a provider.
   */
  async reIngestEvent(
    providerId: string,
    eventId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<IngestionJob> {
    const provider = MOCK_PROVIDERS.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }

    const job: IngestionJob = {
      id: `job-reingest-${Date.now()}`,
      providerId,
      sport: provider.sports[0],
      eventId,
      status: 'RUNNING',
      startedAt: new Date(),
      recordsProcessed: 0,
      errors: 0,
    };

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'sportsdata.re_ingest',
      resourceType: 'PROVIDER',
      resourceId: providerId,
      description: `Triggered re-ingestion for event ${eventId} from ${provider.name}`,
      afterState: { jobId: job.id, eventId },
    });

    return job;
  }

  /**
   * Returns unmapped participants awaiting manual mapping.
   */
  async getUnmappedParticipants(): Promise<UnmappedParticipant[]> {
    return MOCK_UNMAPPED;
  }

  /**
   * Maps an external participant ID to an internal participant ID.
   */
  async mapParticipant(
    externalId: string,
    internalId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'sportsdata.map_participant',
      resourceType: 'PARTICIPANT',
      resourceId: externalId,
      description: `Mapped external participant ${externalId} to internal ${internalId}`,
      afterState: { externalId, internalId },
    });
  }
}

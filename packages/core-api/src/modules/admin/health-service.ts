/**
 * HealthService — business logic for platform health monitoring.
 *
 * Provides service health statuses, infrastructure metrics, business metrics,
 * error log browsing, and alert rule management. Returns mock data that will
 * be replaced with real infrastructure probes and metrics stores.
 */

// ---------------------------------------------------------------------------
// Types — Service Health
// ---------------------------------------------------------------------------

export type ServiceStatus = 'UP' | 'DEGRADED' | 'DOWN';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  uptimePercent: number;
  errorRatePercent: number;
  p95LatencyMs: number;
  version: string;
  uptimeSeconds: number;
  checkedAt: Date;
  dependencies: ServiceDependency[];
}

export interface ServiceDependency {
  name: string;
  status: 'UP' | 'DOWN';
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Types — Infrastructure
// ---------------------------------------------------------------------------

export interface InfrastructureMetrics {
  postgres: {
    status: ServiceStatus;
    cpuPercent: number;
    connectionsCurrent: number;
    connectionsMax: number;
    diskUsageGb: number;
    diskTotalGb: number;
    replicationLagMs: number;
    slowQueriesLast24h: number;
  };
  redis: {
    status: ServiceStatus;
    memoryUsedGb: number;
    memoryMaxGb: number;
    keyCount: number;
    hitRatePercent: number;
    connectedClients: number;
    evictedKeysLast24h: number;
  };
  messageBus: {
    status: ServiceStatus;
    queueDepth: number;
    consumerLagSeconds: number;
    messagesPerSecond: number;
    deadLetterCount: number;
  };
  s3Cdn: {
    status: ServiceStatus;
    bandwidthGbPerDay: number;
    requestsLast24h: number;
    errorRatePercent: number;
    storageUsedGb: number;
  };
  checkedAt: Date;
}

// ---------------------------------------------------------------------------
// Types — Business Metrics
// ---------------------------------------------------------------------------

export interface BusinessMetrics {
  activeUsersLast24h: number;
  websocketConnectionsCurrent: number;
  apiRequestsLast24h: number;
  notificationsSent: number;
  notificationsDelivered: number;
  notificationDeliveryRatePercent: number;
  activeContests: number;
  liveDrafts: number;
  checkedAt: Date;
}

// ---------------------------------------------------------------------------
// Types — Error Log
// ---------------------------------------------------------------------------

export interface ErrorLogQuery {
  service?: string;
  severity?: 'ERROR' | 'CRITICAL' | 'WARNING';
  startDate?: string;
  endDate?: string;
  tenant?: string;
  page?: number;
  pageSize?: number;
}

export interface ErrorLogEntry {
  id: string;
  service: string;
  severity: 'ERROR' | 'CRITICAL' | 'WARNING';
  message: string;
  errorType: string;
  requestId: string;
  tenantId?: string;
  userId?: string;
  stackTrace: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface ErrorLogDetail extends ErrorLogEntry {
  httpMethod?: string;
  httpPath?: string;
  httpStatusCode?: number;
  headers?: Record<string, string>;
  requestBody?: Record<string, unknown>;
  responseTimeMs?: number;
  hostName: string;
  environment: string;
}

// ---------------------------------------------------------------------------
// Types — Alert Rules
// ---------------------------------------------------------------------------

export type AlertSeverity = 'P1' | 'P2' | 'P3';
export type AlertChannel = 'SLACK' | 'PAGERDUTY' | 'EMAIL';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  category: 'SERVICE' | 'ERROR_RATE' | 'INFRASTRUCTURE' | 'BUSINESS';
  isEnabled: boolean;
  isMuted: boolean;
  mutedUntil?: Date;
  severity: AlertSeverity;
  channels: AlertChannel[];
  thresholds: Record<string, number>;
  windowMinutes: number;
  lastTriggeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertRuleUpdate {
  isEnabled?: boolean;
  severity?: AlertSeverity;
  channels?: AlertChannel[];
  thresholds?: Record<string, number>;
  windowMinutes?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ErrorLogEntryNotFoundError extends Error {
  constructor(errorId: string) {
    super(`Error log entry not found: ${errorId}`);
    this.name = 'ErrorLogEntryNotFoundError';
  }
}

export class AlertRuleNotFoundError extends Error {
  constructor(alertId: string) {
    super(`Alert rule not found: ${alertId}`);
    this.name = 'AlertRuleNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Mock data constants
// ---------------------------------------------------------------------------

const NOW = new Date();

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

const MOCK_SERVICES: ServiceHealth[] = [
  {
    name: 'core-api',
    status: 'UP',
    uptimePercent: 99.99,
    errorRatePercent: 0.02,
    p95LatencyMs: 45,
    version: '1.8.2',
    uptimeSeconds: 1_728_000,
    checkedAt: NOW,
    dependencies: [
      { name: 'PostgreSQL', status: 'UP', latencyMs: 3 },
      { name: 'Redis', status: 'UP', latencyMs: 1 },
    ],
  },
  {
    name: 'auth-service',
    status: 'UP',
    uptimePercent: 99.99,
    errorRatePercent: 0.01,
    p95LatencyMs: 32,
    version: '1.4.0',
    uptimeSeconds: 2_592_000,
    checkedAt: NOW,
    dependencies: [
      { name: 'PostgreSQL', status: 'UP', latencyMs: 2 },
      { name: 'Redis', status: 'UP', latencyMs: 1 },
    ],
  },
  {
    name: 'draft-service',
    status: 'UP',
    uptimePercent: 100,
    errorRatePercent: 0.0,
    p95LatencyMs: 55,
    version: '2.1.0',
    uptimeSeconds: 864_000,
    checkedAt: NOW,
    dependencies: [
      { name: 'PostgreSQL', status: 'UP', latencyMs: 4 },
      { name: 'Redis', status: 'UP', latencyMs: 1 },
      { name: 'MessageBus', status: 'UP', latencyMs: 2 },
    ],
  },
  {
    name: 'scoring-service',
    status: 'UP',
    uptimePercent: 99.97,
    errorRatePercent: 0.08,
    p95LatencyMs: 120,
    version: '1.6.3',
    uptimeSeconds: 432_000,
    checkedAt: NOW,
    dependencies: [
      { name: 'PostgreSQL', status: 'UP', latencyMs: 5 },
      { name: 'Redis', status: 'UP', latencyMs: 1 },
      { name: 'MessageBus', status: 'UP', latencyMs: 3 },
    ],
  },
  {
    name: 'notification-service',
    status: 'UP',
    uptimePercent: 99.99,
    errorRatePercent: 0.03,
    p95LatencyMs: 40,
    version: '1.2.1',
    uptimeSeconds: 1_296_000,
    checkedAt: NOW,
    dependencies: [
      { name: 'Redis', status: 'UP', latencyMs: 1 },
      { name: 'MessageBus', status: 'UP', latencyMs: 2 },
    ],
  },
  {
    name: 'ingestion-worker',
    status: 'DEGRADED',
    uptimePercent: 99.85,
    errorRatePercent: 2.3,
    p95LatencyMs: 850,
    version: '1.3.0',
    uptimeSeconds: 172_800,
    checkedAt: NOW,
    dependencies: [
      { name: 'PostgreSQL', status: 'UP', latencyMs: 6 },
      { name: 'MessageBus', status: 'UP', latencyMs: 4 },
      { name: 'SportsDataIO', status: 'UP', latencyMs: 245 },
      { name: 'Equibase', status: 'DOWN', latencyMs: 0 },
    ],
  },
  {
    name: 'websocket-server',
    status: 'UP',
    uptimePercent: 99.95,
    errorRatePercent: 0.10,
    p95LatencyMs: 15,
    version: '1.1.4',
    uptimeSeconds: 604_800,
    checkedAt: NOW,
    dependencies: [
      { name: 'Redis', status: 'UP', latencyMs: 1 },
    ],
  },
];

const MOCK_INFRASTRUCTURE: InfrastructureMetrics = {
  postgres: {
    status: 'UP',
    cpuPercent: 35,
    connectionsCurrent: 120,
    connectionsMax: 500,
    diskUsageGb: 42.3,
    diskTotalGb: 200,
    replicationLagMs: 12,
    slowQueriesLast24h: 7,
  },
  redis: {
    status: 'UP',
    memoryUsedGb: 2.1,
    memoryMaxGb: 8,
    keyCount: 450_000,
    hitRatePercent: 98.7,
    connectedClients: 28,
    evictedKeysLast24h: 0,
  },
  messageBus: {
    status: 'UP',
    queueDepth: 12,
    consumerLagSeconds: 0.5,
    messagesPerSecond: 84,
    deadLetterCount: 3,
  },
  s3Cdn: {
    status: 'UP',
    bandwidthGbPerDay: 45,
    requestsLast24h: 320_000,
    errorRatePercent: 0.01,
    storageUsedGb: 128.5,
  },
  checkedAt: NOW,
};

const MOCK_BUSINESS_METRICS: BusinessMetrics = {
  activeUsersLast24h: 1_245,
  websocketConnectionsCurrent: 342,
  apiRequestsLast24h: 125_000,
  notificationsSent: 8_450,
  notificationsDelivered: 8_320,
  notificationDeliveryRatePercent: 98.5,
  activeContests: 156,
  liveDrafts: 3,
  checkedAt: NOW,
};

const MOCK_ERRORS: ErrorLogEntry[] = [
  {
    id: 'err-001',
    service: 'ingestion-worker',
    severity: 'ERROR',
    message: 'Equibase API returned 503 Service Unavailable',
    errorType: 'ProviderUnavailableError',
    requestId: 'req-9a1b2c3d',
    stackTrace: buildStackTrace('ProviderUnavailableError', 'Equibase API returned 503 Service Unavailable', [
      'at EquibaseAdapter.fetchResults (ingestion-worker/src/adapters/equibase.ts:112:11)',
      'at IngestionPipeline.poll (ingestion-worker/src/pipeline.ts:67:24)',
      'at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ]),
    metadata: { provider: 'equibase', endpoint: '/results/latest', httpStatus: 503 },
    occurredAt: minutesAgo(12),
  },
  {
    id: 'err-002',
    service: 'ingestion-worker',
    severity: 'ERROR',
    message: 'Equibase API connection timeout after 10000ms',
    errorType: 'ConnectionTimeoutError',
    requestId: 'req-4e5f6a7b',
    stackTrace: buildStackTrace('ConnectionTimeoutError', 'Equibase API connection timeout after 10000ms', [
      'at EquibaseAdapter.fetchSchedule (ingestion-worker/src/adapters/equibase.ts:85:11)',
      'at IngestionPipeline.poll (ingestion-worker/src/pipeline.ts:67:24)',
      'at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ]),
    metadata: { provider: 'equibase', endpoint: '/schedule', timeoutMs: 10_000 },
    occurredAt: minutesAgo(18),
  },
  {
    id: 'err-003',
    service: 'scoring-service',
    severity: 'ERROR',
    message: 'Score calculation failed: missing player stats for participant p-4421',
    errorType: 'MissingStatsError',
    requestId: 'req-8c9d0e1f',
    tenantId: '00000000-0000-0000-0000-000000000001',
    stackTrace: buildStackTrace('MissingStatsError', 'Missing player stats for participant p-4421', [
      'at ScoringEngine.calculateScore (scoring-service/src/engine.ts:203:15)',
      'at ContestScorer.processEvent (scoring-service/src/contest-scorer.ts:88:22)',
      'at MessageHandler.onStatEvent (scoring-service/src/handlers/stat-event.ts:34:18)',
    ]),
    metadata: { contestId: 'contest-042', participantId: 'p-4421', sport: 'NFL' },
    occurredAt: minutesAgo(45),
  },
  {
    id: 'err-004',
    service: 'notification-service',
    severity: 'WARNING',
    message: 'Push notification delivery failed: device token expired',
    errorType: 'PushDeliveryError',
    requestId: 'req-2a3b4c5d',
    tenantId: '00000000-0000-0000-0000-000000000002',
    userId: 'user-087',
    stackTrace: buildStackTrace('PushDeliveryError', 'Push notification delivery failed: device token expired', [
      'at APNSAdapter.send (notification-service/src/adapters/apns.ts:67:13)',
      'at NotificationDispatcher.dispatch (notification-service/src/dispatcher.ts:112:20)',
      'at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ]),
    metadata: { channel: 'PUSH', platform: 'iOS', reason: 'BadDeviceToken' },
    occurredAt: hoursAgo(1),
  },
  {
    id: 'err-005',
    service: 'core-api',
    severity: 'ERROR',
    message: 'Database connection pool exhausted — all 500 connections in use',
    errorType: 'ConnectionPoolExhaustedError',
    requestId: 'req-6e7f8a9b',
    stackTrace: buildStackTrace('ConnectionPoolExhaustedError', 'Database connection pool exhausted', [
      'at PrismaClient._request (node_modules/@prisma/client/runtime/library.js:130:22)',
      'at ContestRepository.findActiveContests (core-api/src/repositories/contest.ts:45:18)',
      'at ContestService.listActive (core-api/src/services/contest.ts:22:20)',
    ]),
    metadata: { poolSize: 500, waitingRequests: 23, avgWaitMs: 4500 },
    occurredAt: hoursAgo(3),
  },
  {
    id: 'err-006',
    service: 'draft-service',
    severity: 'CRITICAL',
    message: 'Draft pick persistence failed — transaction rolled back',
    errorType: 'TransactionRollbackError',
    requestId: 'req-0c1d2e3f',
    tenantId: '00000000-0000-0000-0000-000000000001',
    userId: 'user-012',
    stackTrace: buildStackTrace('TransactionRollbackError', 'Draft pick persistence failed — transaction rolled back', [
      'at DraftPickRepository.savePick (draft-service/src/repositories/draft-pick.ts:78:11)',
      'at DraftEngine.processPick (draft-service/src/engine.ts:145:18)',
      'at DraftHandler.onPick (draft-service/src/handlers/pick.ts:56:14)',
    ]),
    metadata: { draftId: 'draft-003', pickNumber: 24, participantId: 'p-1122' },
    occurredAt: hoursAgo(6),
  },
  {
    id: 'err-007',
    service: 'scoring-service',
    severity: 'WARNING',
    message: 'Stale scoring data detected — last update 18 minutes ago for event evt-8833',
    errorType: 'StaleScoringWarning',
    requestId: 'req-4a5b6c7d',
    stackTrace: buildStackTrace('StaleScoringWarning', 'Stale scoring data detected — last update 18 minutes ago', [
      'at FreshnessMonitor.check (scoring-service/src/monitoring/freshness.ts:42:15)',
      'at FreshnessMonitor.runScheduledCheck (scoring-service/src/monitoring/freshness.ts:18:10)',
    ]),
    metadata: { eventId: 'evt-8833', sport: 'NBA', minutesSinceUpdate: 18, threshold: 15 },
    occurredAt: hoursAgo(8),
  },
  {
    id: 'err-008',
    service: 'core-api',
    severity: 'WARNING',
    message: 'Rate limit exceeded for tenant 00000000-0000-0000-0000-000000000003',
    errorType: 'RateLimitExceededError',
    requestId: 'req-8e9f0a1b',
    tenantId: '00000000-0000-0000-0000-000000000003',
    stackTrace: buildStackTrace('RateLimitExceededError', 'Rate limit exceeded', [
      'at RateLimiter.check (core-api/src/middleware/rate-limiter.ts:38:11)',
      'at onRequest (core-api/src/hooks/rate-limit.ts:15:18)',
    ]),
    metadata: { limit: 100, window: '1m', currentCount: 142 },
    occurredAt: hoursAgo(10),
  },
  {
    id: 'err-009',
    service: 'websocket-server',
    severity: 'ERROR',
    message: 'WebSocket connection dropped unexpectedly — 12 clients affected',
    errorType: 'ConnectionDropError',
    requestId: 'req-2c3d4e5f',
    stackTrace: buildStackTrace('ConnectionDropError', 'WebSocket connection dropped unexpectedly', [
      'at WebSocketManager.onError (websocket-server/src/manager.ts:89:13)',
      'at WebSocket.emit (node:events:513:28)',
    ]),
    metadata: { affectedClients: 12, reason: 'EPIPE', reconnectAttempts: 3 },
    occurredAt: hoursAgo(14),
  },
  {
    id: 'err-010',
    service: 'notification-service',
    severity: 'ERROR',
    message: 'Email delivery bounced — invalid recipient address',
    errorType: 'EmailBounceError',
    requestId: 'req-6a7b8c9d',
    tenantId: '00000000-0000-0000-0000-000000000002',
    userId: 'user-055',
    stackTrace: buildStackTrace('EmailBounceError', 'Email delivery bounced — invalid recipient address', [
      'at SESAdapter.send (notification-service/src/adapters/ses.ts:94:11)',
      'at NotificationDispatcher.dispatch (notification-service/src/dispatcher.ts:98:20)',
      'at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ]),
    metadata: { channel: 'EMAIL', bounceType: 'Permanent', recipient: 'invalid@nowhere.test' },
    occurredAt: hoursAgo(18),
  },
];

const MOCK_ERROR_DETAILS: Record<string, Omit<ErrorLogDetail, keyof ErrorLogEntry>> = {
  'err-001': {
    httpMethod: 'GET',
    httpPath: '/providers/equibase/results/latest',
    httpStatusCode: 503,
    headers: { 'x-request-id': 'req-9a1b2c3d', 'user-agent': 'PoolMaster-Ingestion/1.3.0' },
    responseTimeMs: 3200,
    hostName: 'ingestion-worker-pod-7b4c9',
    environment: 'production',
  },
  'err-003': {
    httpMethod: 'POST',
    httpPath: '/scoring/calculate',
    httpStatusCode: 500,
    headers: { 'x-request-id': 'req-8c9d0e1f', 'x-tenant-id': '00000000-0000-0000-0000-000000000001' },
    requestBody: { contestId: 'contest-042', eventId: 'evt-7721' },
    responseTimeMs: 145,
    hostName: 'scoring-service-pod-3a2f8',
    environment: 'production',
  },
  'err-005': {
    httpMethod: 'GET',
    httpPath: '/api/v1/contests?status=active',
    httpStatusCode: 503,
    headers: { 'x-request-id': 'req-6e7f8a9b', 'authorization': 'Bearer [redacted]' },
    responseTimeMs: 4500,
    hostName: 'core-api-pod-1c5d2',
    environment: 'production',
  },
  'err-006': {
    httpMethod: 'POST',
    httpPath: '/drafts/draft-003/picks',
    httpStatusCode: 500,
    headers: { 'x-request-id': 'req-0c1d2e3f', 'x-tenant-id': '00000000-0000-0000-0000-000000000001' },
    requestBody: { participantId: 'p-1122', pickNumber: 24 },
    responseTimeMs: 890,
    hostName: 'draft-service-pod-9e6a3',
    environment: 'production',
  },
};

const MOCK_ALERTS: AlertRule[] = [
  {
    id: 'alert-001',
    name: 'Service Down',
    description: 'Fires when any service reports DOWN status',
    category: 'SERVICE',
    isEnabled: true,
    isMuted: false,
    severity: 'P1',
    channels: ['SLACK', 'PAGERDUTY'],
    thresholds: { consecutiveFailures: 3 },
    windowMinutes: 2,
    lastTriggeredAt: undefined,
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-01-15'),
  },
  {
    id: 'alert-002',
    name: 'Error Rate High',
    description: 'Fires when error rate exceeds 5% over a 5-minute window',
    category: 'ERROR_RATE',
    isEnabled: true,
    isMuted: false,
    severity: 'P2',
    channels: ['SLACK'],
    thresholds: { errorRatePercent: 5 },
    windowMinutes: 5,
    lastTriggeredAt: minutesAgo(45),
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-01-15'),
  },
  {
    id: 'alert-003',
    name: 'Error Rate Critical',
    description: 'Fires when error rate exceeds 20% over a 5-minute window',
    category: 'ERROR_RATE',
    isEnabled: true,
    isMuted: false,
    severity: 'P1',
    channels: ['SLACK', 'PAGERDUTY'],
    thresholds: { errorRatePercent: 20 },
    windowMinutes: 5,
    lastTriggeredAt: undefined,
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-01-15'),
  },
  {
    id: 'alert-004',
    name: 'DB Connections High',
    description: 'Fires when database connection usage exceeds threshold percentage',
    category: 'INFRASTRUCTURE',
    isEnabled: true,
    isMuted: false,
    severity: 'P3',
    channels: ['SLACK'],
    thresholds: { connectionPercent: 80 },
    windowMinutes: 5,
    lastTriggeredAt: hoursAgo(3),
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-02-10'),
  },
  {
    id: 'alert-005',
    name: 'Redis Memory High',
    description: 'Fires when Redis memory usage exceeds threshold percentage',
    category: 'INFRASTRUCTURE',
    isEnabled: true,
    isMuted: false,
    severity: 'P2',
    channels: ['SLACK'],
    thresholds: { memoryPercent: 85 },
    windowMinutes: 5,
    lastTriggeredAt: undefined,
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-01-15'),
  },
  {
    id: 'alert-006',
    name: 'Queue Depth High',
    description: 'Fires when message bus queue depth exceeds threshold',
    category: 'INFRASTRUCTURE',
    isEnabled: true,
    isMuted: false,
    severity: 'P2',
    channels: ['SLACK'],
    thresholds: { queueDepth: 1000 },
    windowMinutes: 5,
    lastTriggeredAt: undefined,
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-01-15'),
  },
  {
    id: 'alert-007',
    name: 'Scoring Data Stale',
    description: 'Fires when scoring data has not been updated within threshold minutes',
    category: 'BUSINESS',
    isEnabled: true,
    isMuted: true,
    mutedUntil: new Date(NOW.getTime() + 3_600_000),
    severity: 'P2',
    channels: ['SLACK'],
    thresholds: { staleMinutes: 15 },
    windowMinutes: 1,
    lastTriggeredAt: hoursAgo(8),
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-03-26'),
  },
  {
    id: 'alert-008',
    name: 'Notification Failure Rate',
    description: 'Fires when notification delivery failure rate exceeds threshold',
    category: 'BUSINESS',
    isEnabled: true,
    isMuted: false,
    severity: 'P2',
    channels: ['SLACK'],
    thresholds: { failureRatePercent: 10 },
    windowMinutes: 15,
    lastTriggeredAt: undefined,
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-01-15'),
  },
  {
    id: 'alert-009',
    name: 'Service Degraded',
    description: 'Fires when any service reports DEGRADED status',
    category: 'SERVICE',
    isEnabled: true,
    isMuted: false,
    severity: 'P2',
    channels: ['SLACK'],
    thresholds: { consecutiveChecks: 2 },
    windowMinutes: 3,
    lastTriggeredAt: minutesAgo(12),
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2026-01-15'),
  },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildStackTrace(name: string, message: string, frames: string[]): string {
  return `${name}: ${message}\n${frames.map((f) => `    ${f}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HealthService {
  /**
   * Returns health status for all platform services.
   *
   * Placeholder: returns mock data. Will poll each service's /health endpoint.
   */
  async getServiceHealth(): Promise<ServiceHealth[]> {
    // TODO: Poll real service health endpoints
    return MOCK_SERVICES;
  }

  /**
   * Returns infrastructure metrics (DB, Redis, message bus, S3/CDN).
   *
   * Placeholder: returns mock data. Will query monitoring backends.
   */
  async getInfrastructureMetrics(): Promise<InfrastructureMetrics> {
    // TODO: Query real infrastructure monitoring
    return MOCK_INFRASTRUCTURE;
  }

  /**
   * Returns key business metrics for the platform.
   *
   * Placeholder: returns mock data. Will aggregate from analytics.
   */
  async getBusinessMetrics(): Promise<BusinessMetrics> {
    // TODO: Aggregate from real analytics stores
    return MOCK_BUSINESS_METRICS;
  }

  /**
   * Searches recent error log entries with optional filters.
   *
   * Placeholder: returns filtered mock data. Will query centralized logging.
   */
  async searchErrors(
    query: ErrorLogQuery,
  ): Promise<{ items: ErrorLogEntry[]; total: number }> {
    let filtered = [...MOCK_ERRORS];
    if (query.service) {
      filtered = filtered.filter((e) => e.service === query.service);
    }
    if (query.severity) {
      filtered = filtered.filter((e) => e.severity === query.severity);
    }
    if (query.tenant) {
      filtered = filtered.filter((e) => e.tenantId === query.tenant);
    }
    if (query.startDate) {
      const start = new Date(query.startDate);
      filtered = filtered.filter((e) => e.occurredAt >= start);
    }
    if (query.endDate) {
      const end = new Date(query.endDate);
      filtered = filtered.filter((e) => e.occurredAt <= end);
    }
    const total = filtered.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    return { items, total };
  }

  /**
   * Returns the full detail for a single error log entry.
   */
  async getErrorDetail(errorId: string): Promise<ErrorLogDetail> {
    const entry = MOCK_ERRORS.find((e) => e.id === errorId);
    if (!entry) {
      throw new ErrorLogEntryNotFoundError(errorId);
    }
    const extra = MOCK_ERROR_DETAILS[errorId] ?? {
      hostName: `${entry.service}-pod-unknown`,
      environment: 'production',
    };
    return { ...entry, ...extra };
  }

  /**
   * Returns all configured alert rules.
   */
  async getAlertRules(): Promise<AlertRule[]> {
    // TODO: Query alert_rules table via Prisma
    return MOCK_ALERTS;
  }

  /**
   * Updates thresholds, channels, or enabled state for an alert rule.
   */
  async updateAlertRule(alertId: string, update: AlertRuleUpdate): Promise<AlertRule> {
    const rule = MOCK_ALERTS.find((a) => a.id === alertId);
    if (!rule) {
      throw new AlertRuleNotFoundError(alertId);
    }
    // TODO: Persist update via Prisma
    if (update.isEnabled !== undefined) rule.isEnabled = update.isEnabled;
    if (update.severity !== undefined) rule.severity = update.severity;
    if (update.channels !== undefined) rule.channels = update.channels;
    if (update.thresholds !== undefined) rule.thresholds = update.thresholds;
    if (update.windowMinutes !== undefined) rule.windowMinutes = update.windowMinutes;
    rule.updatedAt = new Date();
    return rule;
  }

  /**
   * Mutes an alert for a specified duration in minutes.
   */
  async muteAlert(alertId: string, durationMinutes: number): Promise<AlertRule> {
    const rule = MOCK_ALERTS.find((a) => a.id === alertId);
    if (!rule) {
      throw new AlertRuleNotFoundError(alertId);
    }
    // TODO: Persist via Prisma
    rule.isMuted = true;
    rule.mutedUntil = new Date(Date.now() + durationMinutes * 60_000);
    rule.updatedAt = new Date();
    return rule;
  }

  /**
   * Unmutes a previously muted alert.
   */
  async unmuteAlert(alertId: string): Promise<AlertRule> {
    const rule = MOCK_ALERTS.find((a) => a.id === alertId);
    if (!rule) {
      throw new AlertRuleNotFoundError(alertId);
    }
    // TODO: Persist via Prisma
    rule.isMuted = false;
    rule.mutedUntil = undefined;
    rule.updatedAt = new Date();
    return rule;
  }
}

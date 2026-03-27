/**
 * SupportService — consolidated investigation data for support staff.
 *
 * Provides a unified view of tenant health: recent errors, notification
 * failures, API request samples, and scoring staleness. All data is mock
 * for now, to be wired to real observability backends later.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantError {
  id: string;
  service: string;
  errorType: string;
  message: string;
  stackTrace?: string;
  occurredAt: Date;
  requestId: string;
}

export interface NotificationFailure {
  id: string;
  eventType: string;
  channel: string;
  failureReason: string;
  userId: string;
  occurredAt: Date;
}

export interface ApiRequestSample {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  userId?: string;
  occurredAt: Date;
}

export interface ScoringStaleness {
  contestId: string;
  contestName: string;
  sport: string;
  lastScoringUpdate: Date;
  staleMinutes: number;
}

export interface TenantInvestigation {
  tenantId: string;
  recentErrors: TenantError[];
  notificationFailures: NotificationFailure[];
  recentRequests: ApiRequestSample[];
  scoringStaleness: ScoringStaleness[];
  pendingCorrections: number;
  failedWebhooks: number;
}

// ---------------------------------------------------------------------------
// Mock data generators
// ---------------------------------------------------------------------------

function mockErrors(tenantId: string): TenantError[] {
  const now = new Date();
  return [
    {
      id: `err-${tenantId}-001`,
      service: 'scoring-engine',
      errorType: 'TimeoutError',
      message: 'Timed out fetching scores from SportsDataIO after 10000ms',
      stackTrace: 'TimeoutError: Timed out\n  at ScoringClient.fetch (scoring-client.ts:42)',
      occurredAt: new Date(now.getTime() - 15 * 60_000),
      requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    },
    {
      id: `err-${tenantId}-002`,
      service: 'contest-service',
      errorType: 'ValidationError',
      message: 'Contest entry submission failed: roster size exceeds limit',
      occurredAt: new Date(now.getTime() - 45 * 60_000),
      requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    },
    {
      id: `err-${tenantId}-003`,
      service: 'notification-service',
      errorType: 'DeliveryError',
      message: 'Push notification delivery failed: device token expired',
      occurredAt: new Date(now.getTime() - 2 * 3_600_000),
      requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    },
  ];
}

function mockNotificationFailures(tenantId: string): NotificationFailure[] {
  const now = new Date();
  return [
    {
      id: `nf-${tenantId}-001`,
      eventType: 'draft.pick_made',
      channel: 'PUSH',
      failureReason: 'Device token expired',
      userId: `user-${tenantId}-101`,
      occurredAt: new Date(now.getTime() - 30 * 60_000),
    },
    {
      id: `nf-${tenantId}-002`,
      eventType: 'contest.scoring_update',
      channel: 'EMAIL',
      failureReason: 'Mailbox full — 552 5.2.2',
      userId: `user-${tenantId}-205`,
      occurredAt: new Date(now.getTime() - 3 * 3_600_000),
    },
  ];
}

function mockRequests(tenantId: string): ApiRequestSample[] {
  const now = new Date();
  return [
    {
      id: `api-${tenantId}-001`,
      method: 'GET',
      path: '/api/v1/contests/active',
      statusCode: 200,
      latencyMs: 45,
      userId: `user-${tenantId}-101`,
      occurredAt: new Date(now.getTime() - 5_000),
    },
    {
      id: `api-${tenantId}-002`,
      method: 'POST',
      path: '/api/v1/entries',
      statusCode: 422,
      latencyMs: 120,
      userId: `user-${tenantId}-205`,
      occurredAt: new Date(now.getTime() - 30_000),
    },
    {
      id: `api-${tenantId}-003`,
      method: 'GET',
      path: '/api/v1/standings',
      statusCode: 200,
      latencyMs: 88,
      userId: `user-${tenantId}-310`,
      occurredAt: new Date(now.getTime() - 60_000),
    },
    {
      id: `api-${tenantId}-004`,
      method: 'GET',
      path: '/api/v1/scores/live',
      statusCode: 504,
      latencyMs: 10_000,
      occurredAt: new Date(now.getTime() - 15 * 60_000),
    },
  ];
}

function mockStaleness(tenantId: string): ScoringStaleness[] {
  void tenantId;
  return [
    {
      contestId: 'contest-golf-001',
      contestName: 'Masters 2026 Pool',
      sport: 'golf',
      lastScoringUpdate: new Date(Date.now() - 18 * 60_000),
      staleMinutes: 18,
    },
  ];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SupportService {
  /**
   * Returns a consolidated investigation view for a tenant. Combines recent
   * errors, notification failures, API request samples, and scoring staleness.
   */
  async getInvestigation(tenantId: string): Promise<TenantInvestigation> {
    return {
      tenantId,
      recentErrors: mockErrors(tenantId),
      notificationFailures: mockNotificationFailures(tenantId),
      recentRequests: mockRequests(tenantId),
      scoringStaleness: mockStaleness(tenantId),
      pendingCorrections: 2,
      failedWebhooks: 1,
    };
  }

  /**
   * Returns recent errors for a tenant.
   */
  async getErrors(tenantId: string): Promise<TenantError[]> {
    return mockErrors(tenantId);
  }

  /**
   * Returns notification failures for a tenant.
   */
  async getNotificationFailures(tenantId: string): Promise<NotificationFailure[]> {
    return mockNotificationFailures(tenantId);
  }

  /**
   * Returns recent API request samples for a tenant.
   */
  async getRequests(tenantId: string): Promise<ApiRequestSample[]> {
    return mockRequests(tenantId);
  }
}

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';

export interface ServiceStatus {
  name: string;
  status: 'UP' | 'DEGRADED' | 'DOWN';
  uptime: string;
  errorRate: string;
  p95Latency: string;
  version: string;
}

export interface InfraMetric {
  name: string;
  metric1Label: string;
  metric1Value: string;
  metric2Label: string;
  metric2Value: string;
}

export interface KeyMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface HealthDashboard {
  services: ServiceStatus[];
  infrastructure: InfraMetric[];
  keyMetrics: KeyMetric[];
  lastRefreshed: Date;
}

const MOCK_HEALTH: HealthDashboard = {
  services: [
    { name: 'API Gateway', status: 'UP', uptime: '99.99%', errorRate: '0.02%', p95Latency: '45ms', version: 'v1.2.0' },
    { name: 'Auth Service', status: 'UP', uptime: '99.99%', errorRate: '0.01%', p95Latency: '32ms', version: 'v1.1.0' },
    { name: 'Contest Service', status: 'UP', uptime: '99.98%', errorRate: '0.05%', p95Latency: '68ms', version: 'v1.2.0' },
    { name: 'Draft Service', status: 'UP', uptime: '100%', errorRate: '0.00%', p95Latency: '55ms', version: 'v1.0.0' },
    { name: 'Scoring Engine', status: 'UP', uptime: '99.97%', errorRate: '0.08%', p95Latency: '120ms', version: 'v1.3.0' },
    { name: 'Notification Svc', status: 'UP', uptime: '99.99%', errorRate: '0.03%', p95Latency: '40ms', version: 'v1.1.0' },
    { name: 'Ingestion Worker', status: 'DEGRADED', uptime: '99.95%', errorRate: '2.1%', p95Latency: '450ms', version: 'v1.2.0' },
  ],
  infrastructure: [
    { name: 'PostgreSQL', metric1Label: 'CPU', metric1Value: '35%', metric2Label: 'Connections', metric2Value: '120/500' },
    { name: 'Redis', metric1Label: 'Memory', metric1Value: '2.1GB/8GB', metric2Label: 'Keys', metric2Value: '450K' },
    { name: 'Message Bus', metric1Label: 'Queue depth', metric1Value: '12', metric2Label: 'Lag', metric2Value: '0.5s' },
    { name: 'S3/CDN', metric1Label: 'Bandwidth', metric1Value: '45 GB/day', metric2Label: '', metric2Value: '' },
  ],
  keyMetrics: [
    { label: 'Active Users (24h)', value: '1,245' },
    { label: 'API Requests (24h)', value: '125K' },
    { label: 'Notifications', value: '8,450 sent', detail: '8,320 delivered (98.5%)' },
    { label: 'Active Contests', value: '156' },
    { label: 'Live Drafts', value: '3' },
  ],
  lastRefreshed: new Date(),
};

export function useHealthDashboard() {
  return useQuery({
    queryKey: ['health-dashboard'],
    queryFn: async (): Promise<HealthDashboard> => {
      try {
        const [services, infrastructure, keyMetrics] = await Promise.all([
          adminApi.get<ServiceStatus[]>('/v1/admin/health/services'),
          adminApi.get<InfraMetric[]>('/v1/admin/health/infrastructure'),
          adminApi.get<KeyMetric[]>('/v1/admin/health/metrics'),
        ]);
        return { services, infrastructure, keyMetrics, lastRefreshed: new Date() };
      } catch {
        return { ...MOCK_HEALTH, lastRefreshed: new Date() };
      }
    },
    refetchInterval: 30_000,
  });
}

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  service: string;
  severity: 'Error' | 'Warning' | 'Critical';
  errorType: string;
  message: string;
  tenant: string;
  requestId: string;
  stackTrace: string;
}

export interface ErrorLogFilters {
  service: string;
  severity: string;
  dateFrom: string;
  dateTo: string;
  page: number;
}

const MOCK_ERRORS: ErrorLogEntry[] = [
  {
    id: 'err-001',
    timestamp: '2026-03-26T14:32:10Z',
    service: 'Scoring Engine',
    severity: 'Critical',
    errorType: 'TimeoutError',
    message: 'Scoring calculation timed out after 30s for contest cst_abc123',
    tenant: 'acme-corp',
    requestId: 'req_a1b2c3d4',
    stackTrace: 'TimeoutError: Scoring calculation timed out after 30s\n    at ScoringEngine.calculate (/app/src/scoring/engine.ts:142:11)\n    at async ContestService.recalculate (/app/src/contest/service.ts:89:5)\n    at async Router.handle (/app/src/routes/contest.ts:34:3)',
  },
  {
    id: 'err-002',
    timestamp: '2026-03-26T14:28:45Z',
    service: 'Ingestion Worker',
    severity: 'Error',
    errorType: 'ParseError',
    message: 'Failed to parse provider response: unexpected token at position 1024',
    tenant: 'global',
    requestId: 'req_e5f6g7h8',
    stackTrace: 'ParseError: Failed to parse provider response\n    at JSONParser.parse (/app/src/ingestion/parser.ts:56:15)\n    at IngestionWorker.process (/app/src/ingestion/worker.ts:78:12)\n    at async Queue.run (/app/src/queue/runner.ts:23:7)',
  },
  {
    id: 'err-003',
    timestamp: '2026-03-26T14:15:22Z',
    service: 'Auth Service',
    severity: 'Warning',
    errorType: 'RateLimitExceeded',
    message: 'Rate limit exceeded for IP 192.168.1.100 — 150 requests in 60s',
    tenant: 'beta-league',
    requestId: 'req_i9j0k1l2',
    stackTrace: 'RateLimitExceeded: 150 requests in 60s from 192.168.1.100\n    at RateLimiter.check (/app/src/auth/rate-limiter.ts:34:9)\n    at AuthMiddleware.handle (/app/src/auth/middleware.ts:22:5)',
  },
  {
    id: 'err-004',
    timestamp: '2026-03-26T13:58:03Z',
    service: 'Contest Service',
    severity: 'Error',
    errorType: 'ValidationError',
    message: 'Invalid contest configuration: maxEntries must be > 0',
    tenant: 'acme-corp',
    requestId: 'req_m3n4o5p6',
    stackTrace: 'ValidationError: maxEntries must be > 0\n    at ContestValidator.validate (/app/src/contest/validator.ts:67:11)\n    at ContestService.create (/app/src/contest/service.ts:23:5)',
  },
  {
    id: 'err-005',
    timestamp: '2026-03-26T13:45:11Z',
    service: 'Notification Svc',
    severity: 'Warning',
    errorType: 'DeliveryFailure',
    message: 'Push notification delivery failed for 12 devices — APNs returned 410 Gone',
    tenant: 'sports-hub',
    requestId: 'req_q7r8s9t0',
    stackTrace: 'DeliveryFailure: APNs returned 410 Gone for 12 devices\n    at PushService.send (/app/src/notifications/push.ts:89:13)\n    at NotificationWorker.deliver (/app/src/notifications/worker.ts:45:7)',
  },
  {
    id: 'err-006',
    timestamp: '2026-03-26T13:30:55Z',
    service: 'API Gateway',
    severity: 'Error',
    errorType: 'UpstreamError',
    message: 'Upstream service "contest-service" returned 503 Service Unavailable',
    tenant: 'global',
    requestId: 'req_u1v2w3x4',
    stackTrace: 'UpstreamError: contest-service returned 503\n    at Gateway.proxy (/app/src/gateway/proxy.ts:112:9)\n    at Router.handle (/app/src/gateway/router.ts:56:5)',
  },
  {
    id: 'err-007',
    timestamp: '2026-03-26T13:12:40Z',
    service: 'Ingestion Worker',
    severity: 'Critical',
    errorType: 'ConnectionError',
    message: 'Lost connection to provider API — retrying in 30s (attempt 3/5)',
    tenant: 'global',
    requestId: 'req_y5z6a7b8',
    stackTrace: 'ConnectionError: ECONNREFUSED 10.0.1.50:443\n    at ProviderClient.fetch (/app/src/ingestion/client.ts:34:11)\n    at IngestionWorker.poll (/app/src/ingestion/worker.ts:56:9)',
  },
  {
    id: 'err-008',
    timestamp: '2026-03-26T12:55:18Z',
    service: 'Draft Service',
    severity: 'Error',
    errorType: 'ConflictError',
    message: 'Concurrent draft pick conflict — player already drafted in slot 3',
    tenant: 'fantasy-pro',
    requestId: 'req_c9d0e1f2',
    stackTrace: 'ConflictError: Player already drafted in slot 3\n    at DraftService.pick (/app/src/draft/service.ts:134:11)\n    at DraftController.makePick (/app/src/draft/controller.ts:67:5)',
  },
  {
    id: 'err-009',
    timestamp: '2026-03-26T12:40:02Z',
    service: 'Scoring Engine',
    severity: 'Warning',
    errorType: 'StaleDataWarning',
    message: 'Scoring data for provider ESPN is 18 minutes stale — last update at 12:22',
    tenant: 'global',
    requestId: 'req_g3h4i5j6',
    stackTrace: 'StaleDataWarning: ESPN data is 18m stale\n    at ScoringEngine.checkFreshness (/app/src/scoring/freshness.ts:23:7)\n    at ScoringEngine.run (/app/src/scoring/engine.ts:45:5)',
  },
  {
    id: 'err-010',
    timestamp: '2026-03-26T12:25:30Z',
    service: 'Auth Service',
    severity: 'Error',
    errorType: 'TokenError',
    message: 'JWT verification failed — token signature does not match (kid: key-2024-03)',
    tenant: 'acme-corp',
    requestId: 'req_k7l8m9n0',
    stackTrace: 'TokenError: JWT signature mismatch for kid key-2024-03\n    at JWTVerifier.verify (/app/src/auth/jwt.ts:78:11)\n    at AuthMiddleware.authenticate (/app/src/auth/middleware.ts:34:9)',
  },
];

export function useErrorLog(filters: ErrorLogFilters) {
  return useQuery({
    queryKey: ['error-log', filters],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (filters.service && filters.service !== 'All') params.set('service', filters.service);
        if (filters.severity && filters.severity !== 'All') params.set('severity', filters.severity);
        if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
        if (filters.dateTo) params.set('dateTo', filters.dateTo);
        params.set('page', String(filters.page));
        const query = params.toString();
        return await adminApi.get<{ entries: ErrorLogEntry[]; total: number; page: number; pageSize: number; totalPages: number }>(
          `/v1/admin/health/errors${query ? `?${query}` : ''}`,
        );
      } catch {
        let filtered = [...MOCK_ERRORS];
        if (filters.service && filters.service !== 'All') {
          filtered = filtered.filter((e) => e.service === filters.service);
        }
        if (filters.severity && filters.severity !== 'All') {
          filtered = filtered.filter((e) => e.severity === filters.severity);
        }
        const pageSize = 5;
        const start = (filters.page - 1) * pageSize;
        return {
          entries: filtered.slice(start, start + pageSize),
          total: filtered.length,
          page: filters.page,
          pageSize,
          totalPages: Math.ceil(filtered.length / pageSize),
        };
      }
    },
    placeholderData: keepPreviousData,
  });
}

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: string;
  window: string;
  channels: string[];
  severity: 'P1' | 'P2' | 'P3';
  status: 'Active' | 'Muted';
}

const MOCK_ALERTS: AlertRule[] = [
  { id: 'alert-1', name: 'Service Down', condition: 'Service status = DOWN', threshold: '-', window: 'Instant', channels: ['Slack', 'PagerDuty'], severity: 'P1', status: 'Active' },
  { id: 'alert-2', name: 'Service Degraded', condition: 'Service status = DEGRADED', threshold: '-', window: 'Instant', channels: ['Slack'], severity: 'P2', status: 'Active' },
  { id: 'alert-3', name: 'Error Rate High', condition: 'Error rate > threshold', threshold: '5%', window: '5m', channels: ['Slack'], severity: 'P2', status: 'Active' },
  { id: 'alert-4', name: 'Error Rate Critical', condition: 'Error rate > threshold', threshold: '20%', window: '5m', channels: ['Slack', 'PagerDuty'], severity: 'P1', status: 'Active' },
  { id: 'alert-5', name: 'DB Connections High', condition: 'DB connections > threshold', threshold: '80%', window: '5m', channels: ['Slack'], severity: 'P3', status: 'Active' },
  { id: 'alert-6', name: 'Redis Memory High', condition: 'Redis memory > threshold', threshold: '85%', window: '5m', channels: ['Slack'], severity: 'P2', status: 'Active' },
  { id: 'alert-7', name: 'Queue Depth High', condition: 'Queue depth > threshold', threshold: '1000', window: '5m', channels: ['Slack'], severity: 'P2', status: 'Active' },
  { id: 'alert-8', name: 'Scoring Stale', condition: 'Scoring data age > threshold', threshold: '15m', window: '5m', channels: ['Slack'], severity: 'P2', status: 'Muted' },
  { id: 'alert-9', name: 'Notification Failure', condition: 'Notification failure rate > threshold', threshold: '10%', window: '5m', channels: ['Slack'], severity: 'P2', status: 'Active' },
];

export function useAlertRules() {
  return useQuery({
    queryKey: ['alert-rules'],
    queryFn: async (): Promise<AlertRule[]> => {
      try {
        return await adminApi.get<AlertRule[]>('/v1/admin/health/alerts');
      } catch {
        return [...MOCK_ALERTS];
      }
    },
  });
}

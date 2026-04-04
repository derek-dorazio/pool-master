import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  client,
  adminGetServiceHealth,
  adminGetInfrastructureMetrics,
  adminGetBusinessMetrics,
  adminSearchErrors,
  adminGetAlertRules,
} from '@/lib/api';

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

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatMilliseconds(value: number): string {
  return `${Math.round(value)}ms`;
}

export function useHealthDashboard() {
  return useQuery({
    queryKey: ['health-dashboard'],
    queryFn: async (): Promise<HealthDashboard> => {
      const [servicesRes, infraRes, metricsRes] = await Promise.all([
        adminGetServiceHealth({ client }),
        adminGetInfrastructureMetrics({ client }),
        adminGetBusinessMetrics({ client }),
      ]);

      const infrastructure = infraRes.data
        ? [
            {
              name: 'PostgreSQL',
              metric1Label: 'Connections',
              metric1Value: String(infraRes.data.postgres.connectionsCurrent),
              metric2Label: 'Slow queries',
              metric2Value: String(infraRes.data.postgres.slowQueriesLast24h),
            },
            {
              name: 'Message Bus',
              metric1Label: 'Queue depth',
              metric1Value: String(infraRes.data.messageBus.queueDepth),
              metric2Label: 'Dead letters',
              metric2Value: String(infraRes.data.messageBus.deadLetterCount),
            },
            {
              name: 'S3/CDN',
              metric1Label: 'Requests',
              metric1Value: String(infraRes.data.s3Cdn.requestsLast24h),
              metric2Label: 'Storage',
              metric2Value: `${infraRes.data.s3Cdn.storageUsedGb} GB`,
            },
          ]
        : [];

      const keyMetrics = metricsRes.data
        ? [
            {
              label: 'Active Users',
              value: metricsRes.data.activeUsersLast24h.toLocaleString(),
              detail: 'Last 24 hours',
            },
            {
              label: 'API Requests',
              value: metricsRes.data.apiRequestsLast24h.toLocaleString(),
              detail: 'Last 24 hours',
            },
            {
              label: 'Notifications',
              value: metricsRes.data.notificationsSent.toLocaleString(),
              detail: `${metricsRes.data.notificationsDelivered.toLocaleString()} delivered`,
            },
            {
              label: 'Active Contests',
              value: metricsRes.data.activeContests.toLocaleString(),
            },
            {
              label: 'Live Drafts',
              value: metricsRes.data.liveDrafts.toLocaleString(),
            },
          ]
        : [];

      return {
        services: (servicesRes.data?.services ?? []).map((service) => ({
          name: service.name,
          status: service.status,
          uptime: formatPercent(service.uptimePercent),
          errorRate: formatPercent(service.errorRatePercent),
          p95Latency: formatMilliseconds(service.p95LatencyMs),
          version: service.version,
        })),
        infrastructure,
        keyMetrics,
        lastRefreshed: new Date(),
      };
    },
    refetchInterval: 30_000,
  });
}

export function useErrorLog(filters: ErrorLogFilters) {
  return useQuery({
    queryKey: ['error-log', filters],
    queryFn: async () => {
      const query: Record<string, string | number> = {};
      if (filters.service && filters.service !== 'All') query.service = filters.service;
      if (filters.severity && filters.severity !== 'All') {
        query.severity = filters.severity.toUpperCase();
      }
      if (filters.dateFrom) query.dateFrom = filters.dateFrom;
      if (filters.dateTo) query.dateTo = filters.dateTo;
      query.page = filters.page;
      const { data } = await adminSearchErrors({ client, query });

      return {
        total: data?.total ?? 0,
        page: data?.page ?? filters.page,
        pageSize: data?.pageSize ?? 20,
        totalPages: data?.totalPages ?? 0,
        entries: (data?.items ?? []).map((item) => ({
          id: item.id,
          timestamp: item.occurredAt,
          service: item.service,
          severity: item.severity === 'CRITICAL' ? 'Critical' : item.severity === 'WARNING' ? 'Warning' : 'Error',
          errorType: item.errorType,
          message: item.message,
          tenant: item.tenantId ?? 'N/A',
          requestId: item.requestId,
          stackTrace: item.stackTrace,
        })),
      };
    },
    placeholderData: keepPreviousData,
  });
}

export function useAlertRules() {
  return useQuery({
    queryKey: ['alert-rules'],
    queryFn: async () => {
      const { data } = await adminGetAlertRules({ client });
      return (data?.rules ?? []).map((rule) => ({
        id: rule.id,
        name: rule.name,
        condition: rule.description,
        threshold: Object.entries(rule.thresholds).map(([key, value]) => `${key}: ${value}`).join(', '),
        window: `${rule.windowMinutes}m`,
        channels: rule.channels,
        severity: rule.severity,
        status: rule.isMuted ? 'Muted' : 'Active',
      })) satisfies AlertRule[];
    },
  });
}

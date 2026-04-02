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

export function useHealthDashboard() {
  return useQuery({
    queryKey: ['health-dashboard'],
    queryFn: async (): Promise<HealthDashboard> => {
      const [servicesRes, infraRes, metricsRes] = await Promise.all([
        adminGetServiceHealth({ client }),
        adminGetInfrastructureMetrics({ client }),
        adminGetBusinessMetrics({ client }),
      ]);
      return {
        services: servicesRes.data as unknown as ServiceStatus[],
        infrastructure: infraRes.data as unknown as InfraMetric[],
        keyMetrics: metricsRes.data as unknown as KeyMetric[],
        lastRefreshed: new Date(),
      };
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

export function useErrorLog(filters: ErrorLogFilters) {
  return useQuery({
    queryKey: ['error-log', filters],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (filters.service && filters.service !== 'All') query.service = filters.service;
      if (filters.severity && filters.severity !== 'All') query.severity = filters.severity;
      if (filters.dateFrom) query.dateFrom = filters.dateFrom;
      if (filters.dateTo) query.dateTo = filters.dateTo;
      query.page = String(filters.page);
      const { data } = await adminSearchErrors({ client, query });
      return data;
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

export function useAlertRules() {
  return useQuery({
    queryKey: ['alert-rules'],
    queryFn: async () => {
      const { data } = await adminGetAlertRules({ client });
      return data;
    },
  });
}

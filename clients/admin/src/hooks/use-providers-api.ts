import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';

export type ProviderStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface Provider {
  id: string;
  name: string;
  status: ProviderStatus;
  errorRate: number;
  avgLatency: number;
  lastEvent: string;
  activeEvents: number;
}

export interface ProviderError {
  timestamp: string;
  errorType: string;
  message: string;
  eventId: string;
}

export interface IngestionSport {
  sport: string;
  lastPoll: string;
  eventsToday: number;
  errorsToday: number;
  activeEvents: number;
  dependentContests: number;
}

export interface UnmappedParticipant {
  externalId: string;
  providerName: string;
  status: 'Unmapped' | 'Mapped';
}

export interface ProviderDetail extends Provider {
  apiKey: string;
  webhookUrl: string;
  thresholds: {
    degraded: number;
    down: number;
    maxLatency: number;
  };
  budget: {
    monthly: number;
    spent: number;
    alertAt: number;
  };
  recentErrors: ProviderError[];
  sports: IngestionSport[];
  unmapped: UnmappedParticipant[];
}

export interface IngestionJob {
  id: string;
  provider: string;
  sport: string;
  event: string;
  progress: number;
}

const MOCK_PROVIDERS: Provider[] = [
  { id: 'p-001', name: 'SportsDataIO', status: 'HEALTHY', errorRate: 0.2, avgLatency: 145, lastEvent: '12s ago', activeEvents: 24 },
  { id: 'p-002', name: 'Sportradar', status: 'HEALTHY', errorRate: 0.5, avgLatency: 210, lastEvent: '8s ago', activeEvents: 31 },
  { id: 'p-003', name: 'Equibase', status: 'DEGRADED', errorRate: 6.1, avgLatency: 890, lastEvent: '2m ago', activeEvents: 5 },
  { id: 'p-004', name: 'TheOddsAPI', status: 'HEALTHY', errorRate: 0.1, avgLatency: 95, lastEvent: '4s ago', activeEvents: 18 },
  { id: 'p-005', name: 'ESPN', status: 'HEALTHY', errorRate: 0.8, avgLatency: 320, lastEvent: '22s ago', activeEvents: 42 },
  { id: 'p-006', name: 'OpenF1', status: 'DOWN', errorRate: 34.2, avgLatency: 4200, lastEvent: '18m ago', activeEvents: 0 },
];

function buildProviderDetail(provider: Provider): ProviderDetail {
  return {
    ...provider,
    apiKey: 'sk-****-****-abcd',
    webhookUrl: `https://api.poolmaster.io/webhooks/${provider.name.toLowerCase().replace(/\s+/g, '')}`,
    thresholds: { degraded: 5, down: 20, maxLatency: 3000 },
    budget: { monthly: 500, spent: 342, alertAt: 80 },
    recentErrors: [
      { timestamp: '2026-03-26T10:42:00Z', errorType: 'Timeout', message: 'Request timed out after 5000ms', eventId: 'evt-8812' },
      { timestamp: '2026-03-26T10:38:00Z', errorType: 'RateLimit', message: 'Rate limit exceeded (429)', eventId: 'evt-8799' },
      { timestamp: '2026-03-26T10:21:00Z', errorType: 'ParseError', message: 'Invalid JSON in response body', eventId: 'evt-8745' },
      { timestamp: '2026-03-26T09:55:00Z', errorType: 'AuthError', message: 'API key rejected (401)', eventId: 'evt-8701' },
      { timestamp: '2026-03-26T09:30:00Z', errorType: 'Timeout', message: 'Request timed out after 5000ms', eventId: 'evt-8688' },
    ],
    sports: [
      { sport: 'NFL', lastPoll: '12s ago', eventsToday: 342, errorsToday: 2, activeEvents: 8, dependentContests: 12 },
      { sport: 'NBA', lastPoll: '8s ago', eventsToday: 518, errorsToday: 1, activeEvents: 10, dependentContests: 8 },
      { sport: 'Golf', lastPoll: '45s ago', eventsToday: 128, errorsToday: 0, activeEvents: 3, dependentContests: 5 },
      { sport: 'Soccer', lastPoll: '15s ago', eventsToday: 257, errorsToday: 3, activeEvents: 6, dependentContests: 4 },
    ],
    unmapped: [
      { externalId: 'ext-99201', providerName: 'J. Rodriguez (QB)', status: 'Unmapped' },
      { externalId: 'ext-99205', providerName: 'K. Thompson Jr.', status: 'Unmapped' },
      { externalId: 'ext-99210', providerName: 'A. Santos (DEF)', status: 'Unmapped' },
    ],
  };
}

const MOCK_JOBS: IngestionJob[] = [
  { id: 'j-001', provider: 'SportsDataIO', sport: 'NFL', event: 'Week 14 — Chiefs vs Ravens', progress: 72 },
  { id: 'j-002', provider: 'Sportradar', sport: 'NBA', event: 'Celtics vs Lakers', progress: 34 },
];

const MOCK_INGESTION_ERRORS: ProviderError[] = [
  { timestamp: '2026-03-26T10:44:00Z', errorType: 'Timeout', message: 'OpenF1 — Request timed out after 5000ms', eventId: 'evt-8820' },
  { timestamp: '2026-03-26T10:42:00Z', errorType: 'ParseError', message: 'Equibase — Malformed horse data in field positions', eventId: 'evt-8815' },
  { timestamp: '2026-03-26T10:38:00Z', errorType: 'RateLimit', message: 'SportsDataIO — Rate limit exceeded (429)', eventId: 'evt-8799' },
  { timestamp: '2026-03-26T10:30:00Z', errorType: 'Timeout', message: 'OpenF1 — Connection refused', eventId: 'evt-8780' },
  { timestamp: '2026-03-26T10:25:00Z', errorType: 'AuthError', message: 'Equibase — API key expired', eventId: 'evt-8770' },
];

export function useProviderList() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: async () => {
      try {
        return await adminApi.get<Provider[]>('/v1/admin/providers/health');
      } catch {
        return MOCK_PROVIDERS;
      }
    },
  });

  return { data: data ?? MOCK_PROVIDERS, isLoading };
}

export function useProviderDetail(id: string) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'provider', id],
    queryFn: async () => {
      try {
        return await adminApi.get<ProviderDetail>(`/v1/admin/providers/${id}`);
      } catch {
        const provider = MOCK_PROVIDERS.find((p) => p.id === id) ?? MOCK_PROVIDERS[0];
        return buildProviderDetail(provider);
      }
    },
  });

  const fallback = buildProviderDetail(MOCK_PROVIDERS[0]);
  return { data: data ?? fallback, isLoading };
}

export function useIngestionJobs() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'ingestion'],
    queryFn: async () => {
      try {
        return await adminApi.get<{ jobs: IngestionJob[]; errors: ProviderError[]; throughput: number }>('/v1/admin/providers/ingestion');
      } catch {
        return {
          jobs: MOCK_JOBS,
          errors: MOCK_INGESTION_ERRORS,
          throughput: 1245,
        };
      }
    },
  });

  return {
    jobs: data?.jobs ?? MOCK_JOBS,
    errors: data?.errors ?? MOCK_INGESTION_ERRORS,
    throughput: data?.throughput ?? 1245,
    isLoading,
  };
}

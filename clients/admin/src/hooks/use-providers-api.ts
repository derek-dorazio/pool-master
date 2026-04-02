import { useQuery } from '@tanstack/react-query';
import {
  client,
  adminListProviders,
  adminGetProviderDetail,
  adminGetIngestionDashboard,
} from '@/lib/api';

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

export function useProviderList() {
  return useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: async () => {
      const { data } = await adminListProviders({ client });
      return data;
    },
  });
}

export function useProviderDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'provider', id],
    queryFn: async () => {
      const { data } = await adminGetProviderDetail({ client, path: { providerId: id } });
      return data;
    },
  });
}

export function useIngestionJobs() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'ingestion'],
    queryFn: async () => {
      const { data } = await adminGetIngestionDashboard({ client });
      return data as { jobs: IngestionJob[]; errors: ProviderError[]; throughput: number } | undefined;
    },
  });

  return {
    jobs: data?.jobs ?? [],
    errors: data?.errors ?? [],
    throughput: data?.throughput ?? 0,
    isLoading,
  };
}

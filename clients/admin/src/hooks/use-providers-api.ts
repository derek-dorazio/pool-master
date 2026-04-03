import { useQuery } from '@tanstack/react-query';
import {
  client,
  adminListProviders,
  adminGetProviderDetail,
  adminGetIngestionDashboard,
} from '@/lib/api';
import {
  ProviderDetailResponseSchema,
  ProviderIngestionDashboardResponseSchema,
  ProviderListResponseSchema,
  type ProviderDetailResponse,
  type ProviderIngestionDashboardResponse,
  type ProviderSummaryDto,
} from '@poolmaster/shared/dto/admin.dto';

export type ProviderStatus = ProviderSummaryDto['status'];

export function useProviderList() {
  return useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: async (): Promise<ProviderSummaryDto[]> => {
      const { data } = await adminListProviders({ client });
      const parsed = ProviderListResponseSchema.parse(data);
      return parsed.items;
    },
  });
}

export function useProviderDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'provider', id],
    queryFn: async (): Promise<ProviderDetailResponse> => {
      const { data } = await adminGetProviderDetail({ client, path: { providerId: id } });
      return ProviderDetailResponseSchema.parse(data);
    },
  });
}

export function useIngestionJobs() {
  const { data, isLoading, error, isError } = useQuery({
    queryKey: ['admin', 'ingestion'],
    queryFn: async (): Promise<ProviderIngestionDashboardResponse> => {
      const { data } = await adminGetIngestionDashboard({ client });
      return ProviderIngestionDashboardResponseSchema.parse(data);
    },
  });

  return {
    dashboard: data,
    isLoading,
    isError,
    error,
  };
}

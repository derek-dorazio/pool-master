import { useQuery } from '@tanstack/react-query';
import { getIngestionSchedule } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { cloneIngestionConfig, type IngestionScheduleConfig } from './ingestion-settings-utils';

/**
 * The ingestion schedule, as a copy of its own each time it changes, so a page can start its
 * draft from it without editing the cached value.
 */
export function useIngestionScheduleQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.ingestionConfig,
    queryFn: async (): Promise<IngestionScheduleConfig> => {
      const response = await getIngestionSchedule();
      if (!response.data) {
        throwApiError(response.error, 'Ingestion schedule response is missing data.');
      }
      return response.data;
    },
    retry: false,
    select: cloneIngestionConfig,
  });
}

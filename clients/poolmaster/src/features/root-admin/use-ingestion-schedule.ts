import { useQuery } from '@tanstack/react-query';
import { getIngestionSchedule, type IngestionSchedule } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * The ingestion schedule as the API answers it (#2086): each sync kind's policy, whether it runs
 * and whether it has a switch, so the page never decides which sync is always on.
 */
export function useIngestionScheduleQuery() {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.ingestionSchedule,
    queryFn: async (): Promise<IngestionSchedule> => {
      const response = await getIngestionSchedule();
      if (!response.data) {
        throwApiError(response.error, 'Ingestion schedule response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });
}

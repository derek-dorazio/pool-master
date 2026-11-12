import { useQuery } from '@tanstack/react-query';
import { listLeaguePlans, type LeaguePlanListResponse } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * Every plan's caps and features, lowest plan first (#945): the comparison table's columns. With
 * them, how long the Premium gift runs and each plan's contest expansion prices (#973). `enabled`
 * holds it back on a page that needs it only sometimes, such as a locked section.
 */
export function useLeaguePlansQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    enabled,
    queryKey: QueryKeys.plans.list,
    queryFn: async (): Promise<LeaguePlanListResponse> => {
      const response = await listLeaguePlans();

      if (!response.data?.plans) {
        throwApiError(response.error, 'Plan list response is missing data.');
      }

      return response.data;
    },
    retry: false,
  });
}

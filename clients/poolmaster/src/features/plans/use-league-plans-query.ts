import { useQuery } from '@tanstack/react-query';
import { listLeaguePlans, type PlanEntitlementsDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** Every plan's caps and features, lowest plan first (#945): the comparison table's columns. */
export function useLeaguePlansQuery() {
  return useQuery({
    queryKey: QueryKeys.plans.list,
    queryFn: async (): Promise<PlanEntitlementsDto[]> => {
      const response = await listLeaguePlans();

      if (!response.data?.plans) {
        throwApiError(response.error, 'Plan list response is missing data.');
      }

      return response.data.plans;
    },
    retry: false,
  });
}

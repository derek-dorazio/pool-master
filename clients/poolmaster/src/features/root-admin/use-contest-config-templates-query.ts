import { useQuery } from '@tanstack/react-query';
import { listContestConfigTemplates } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ContestConfigTemplate } from './content-configuration-utils';

/** Every contest setup (the fixed set of contest config templates), for the Content pages. */
export function useContestConfigTemplatesQuery() {
  return useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({}),
    queryFn: async (): Promise<ContestConfigTemplate[]> => {
      const response = await listContestConfigTemplates();

      if (!response.data?.templates) {
        throwApiError(response.error, 'Contest template response is missing data.');
      }

      return response.data.templates;
    },
    retry: false,
  });
}

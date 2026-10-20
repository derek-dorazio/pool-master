import { useQuery } from '@tanstack/react-query';
import { listContestConfigTemplates, type ContestConfigTemplateDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/**
 * Every active contest template, of every sport and league (#803): what the contest types pages
 * show, and where Create contest finds a template chosen on one. Anyone may read them, signed in
 * or not.
 */
export function useActiveContestTemplatesQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({ active: true }),
    queryFn: async (): Promise<ContestConfigTemplateDto[]> => {
      const response = await listContestConfigTemplates({ query: { active: true } });
      if (!response.data?.templates) {
        throwApiError(response.error, 'Contest template response is missing data.');
      }
      return response.data.templates;
    },
    enabled,
    retry: false,
  });
}

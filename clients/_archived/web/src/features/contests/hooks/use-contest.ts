import { useQuery } from '@tanstack/react-query';
import { client, getContest } from '@/lib/api';
import {
  ContestResponseSchema,
  type ContestDetailDto,
} from '@poolmaster/shared/dto';

export interface ContestDetailView {
  contest: ContestDetailDto;
  selectionConfig: Record<string, unknown> | null;
}

export function useContest(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contests', contestId],
    queryFn: async (): Promise<ContestDetailView> => {
      const { data, error } = await getContest({ client, path: { contestId: contestId! } });
      if (error) throw error;
      if (!data) {
        throw new Error('Contest response was empty.');
      }
      const parsed = ContestResponseSchema.parse(data);
      return {
        contest: parsed.contest,
        selectionConfig: parsed.selectionConfig ?? null,
      };
    },
    enabled: !!contestId,
  });
}

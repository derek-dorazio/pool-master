import { useQuery } from '@tanstack/react-query';
import { client, getStandings } from '@/lib/api';
import {
  StandingsResponseSchema,
  type StandingsResponse,
} from '@poolmaster/shared/dto';

export function useStandings(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contests', contestId, 'standings'],
    queryFn: async (): Promise<StandingsResponse> => {
      const { data, error } = await getStandings({ client, path: { contestId: contestId! } });
      if (error) throw error;
      if (!data) {
        throw new Error('Standings response was empty.');
      }
      return StandingsResponseSchema.parse(data);
    },
    enabled: !!contestId,
  });
}

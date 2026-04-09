import { useQuery } from '@tanstack/react-query';
import { client, listLeagues } from '@/lib/api';
import type { LeagueSummaryDto, LeagueListResponse } from '@poolmaster/shared/dto';

export function useMyLeagues() {
  return useQuery({
    queryKey: ['dashboard', 'leagues'],
    queryFn: async (): Promise<LeagueSummaryDto[]> => {
      const { data, error } = await listLeagues({ client });
      if (error) throw error;
      return (data as LeagueListResponse | undefined)?.leagues ?? [];
    },
  });
}

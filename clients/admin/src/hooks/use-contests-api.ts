import { useQuery } from '@tanstack/react-query';
import { client, adminListContests, adminGetContestDetail } from '@/lib/api';
import {
  ContestAdminDetailResponseSchema,
  AdminContestListResponseSchema,
  type ContestAdminDetailResponse,
  type ContestListItemDto,
} from '@poolmaster/shared/dto/admin.dto';

export type Contest = ContestListItemDto;
export type ContestFilters = {
  tenant?: string;
  sport?: string;
  status?: string;
  type?: string;
};

export function useContestList(filters: ContestFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'contests', filters],
    queryFn: async (): Promise<ContestListItemDto[]> => {
      const query: Record<string, string> = {};
      if (filters.tenant && filters.tenant !== 'All') query.tenant = filters.tenant;
      if (filters.sport && filters.sport !== 'All') query.sport = filters.sport;
      if (filters.status && filters.status !== 'All') query.status = filters.status;
      if (filters.type && filters.type !== 'All') {
        query.type = filters.type === 'Single Event' ? 'SINGLE_EVENT' : 'SEASON_LONG';
      }
      const { data } = await adminListContests({ client, query });
      const parsed = AdminContestListResponseSchema.parse(data);
      return parsed.items;
    },
  });
}

export function useContestDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'contest', id],
    queryFn: async (): Promise<ContestAdminDetailResponse> => {
      const { data } = await adminGetContestDetail({ client, path: { contestId: id } });
      return ContestAdminDetailResponseSchema.parse(data);
    },
  });
}

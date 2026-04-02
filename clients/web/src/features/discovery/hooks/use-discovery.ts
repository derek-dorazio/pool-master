import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { client, typedData } from '@/lib/api-client-generated';

export interface DiscoverableLeague {
  id: string;
  name: string;
  description: string | null;
  sport: string;
  memberCount: number;
  maxMembers: number | null;
  activeContestCount: number;
  activityLevel: string;
  joinPolicy: string;
  commissionerName: string;
}

export interface DiscoverableContest {
  id: string;
  leagueName: string;
  contestName: string;
  sport: string;
  eventName: string | null;
  draftType: string | null;
  memberCount: number;
  maxMembers: number | null;
  entryFee: number | null;
  prizePool: number | null;
  draftStart: string | null;
  lockTime: string | null;
  status: string;
}

interface LeaguesResponse {
  leagues: DiscoverableLeague[];
  total: number;
}

interface ContestsResponse {
  contests: DiscoverableContest[];
  total: number;
}

export function useTrendingLeagues(sport?: string) {
  return useQuery({
    queryKey: ['discover', 'trending-leagues', sport],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (sport && sport !== 'ALL') query.sport = sport;
      const result = await client.GET('/api/v1/search/discover/leagues', {
        params: { query } as never,
      });
      const response = await typedData<LeaguesResponse>(result);
      return response.leagues;
    },
  });
}

export function usePopularContests(sport?: string) {
  return useQuery({
    queryKey: ['discover', 'popular-contests', sport],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (sport && sport !== 'ALL') query.sport = sport;
      const result = await client.GET('/api/v1/search/discover/contests', {
        params: { query } as never,
      });
      const response = await typedData<ContestsResponse>(result);
      return response.contests;
    },
  });
}

export function useBrowseLeagues(filters: { sport?: string; sort?: string; q?: string }) {
  return useQuery({
    queryKey: ['discover', 'leagues', filters],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (filters.sport && filters.sport !== 'ALL') query.sport = filters.sport;
      if (filters.sort) query.sort = filters.sort;
      if (filters.q) query.q = filters.q;
      const result = await client.GET('/api/v1/search/discover/leagues', {
        params: { query } as never,
      });
      return typedData<LeaguesResponse>(result);
    },
  });
}

export function useBrowseContests(filters: { sport?: string; sort?: string; q?: string }) {
  return useQuery({
    queryKey: ['discover', 'contests', filters],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (filters.sport && filters.sport !== 'ALL') query.sport = filters.sport;
      if (filters.sort) query.sort = filters.sort;
      if (filters.q) query.q = filters.q;
      const result = await client.GET('/api/v1/search/discover/contests', {
        params: { query } as never,
      });
      return typedData<ContestsResponse>(result);
    },
  });
}

export function useJoinLeague() {
  const queryClient = useQueryClient();
  return useMutation({
    // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
    mutationFn: async (leagueId: string) => {
      return await api.post<{ success: boolean }>(
        `/v1/search/discover/leagues/${leagueId}/join`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discover'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'leagues'] });
    },
  });
}

export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: ['discover', 'search', query],
    queryFn: async () => {
      if (!query.trim()) return { leagues: [] as DiscoverableLeague[], contests: [] as DiscoverableContest[] };
      const params = { query: { q: query } } as never;
      const [leagueRes, contestRes] = await Promise.all([
        client.GET('/api/v1/search/discover/leagues', { params }),
        client.GET('/api/v1/search/discover/contests', { params }),
      ]);
      const leagueData = await typedData<LeaguesResponse>(leagueRes);
      const contestData = await typedData<ContestsResponse>(contestRes);
      return {
        leagues: leagueData.leagues,
        contests: contestData.contests,
      };
    },
    enabled: query.trim().length >= 2,
  });
}

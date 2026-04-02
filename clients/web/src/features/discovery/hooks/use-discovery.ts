import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';

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
      const params = new URLSearchParams();
      if (sport && sport !== 'ALL') params.set('sport', sport);
      const response = await api.get<LeaguesResponse>(
        `${clientPath(API_ROUTES.search.leagues)}?${params.toString()}`,
      );
      return response.leagues;
    },
  });
}

export function usePopularContests(sport?: string) {
  return useQuery({
    queryKey: ['discover', 'popular-contests', sport],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sport && sport !== 'ALL') params.set('sport', sport);
      const response = await api.get<ContestsResponse>(
        `${clientPath(API_ROUTES.search.contests)}?${params.toString()}`,
      );
      return response.contests;
    },
  });
}

export function useBrowseLeagues(filters: { sport?: string; sort?: string; q?: string }) {
  return useQuery({
    queryKey: ['discover', 'leagues', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.sport && filters.sport !== 'ALL') params.set('sport', filters.sport);
      if (filters.sort) params.set('sort', filters.sort);
      if (filters.q) params.set('q', filters.q);
      return await api.get<LeaguesResponse>(
        `${clientPath(API_ROUTES.search.leagues)}?${params.toString()}`,
      );
    },
  });
}

export function useBrowseContests(filters: { sport?: string; sort?: string; q?: string }) {
  return useQuery({
    queryKey: ['discover', 'contests', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.sport && filters.sport !== 'ALL') params.set('sport', filters.sport);
      if (filters.sort) params.set('sort', filters.sort);
      if (filters.q) params.set('q', filters.q);
      return await api.get<ContestsResponse>(
        `${clientPath(API_ROUTES.search.contests)}?${params.toString()}`,
      );
    },
  });
}

export function useJoinLeague() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leagueId: string) => {
      return await api.post<{ success: boolean }>(
        `${clientPath(API_ROUTES.search.leagues)}/${leagueId}/join`,
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
      const params = new URLSearchParams({ q: query });
      const [leagueRes, contestRes] = await Promise.all([
        api.get<LeaguesResponse>(
          `${clientPath(API_ROUTES.search.leagues)}?${params.toString()}`,
        ),
        api.get<ContestsResponse>(
          `${clientPath(API_ROUTES.search.contests)}?${params.toString()}`,
        ),
      ]);
      return {
        leagues: leagueRes.leagues,
        contests: contestRes.contests,
      };
    },
    enabled: query.trim().length >= 2,
  });
}

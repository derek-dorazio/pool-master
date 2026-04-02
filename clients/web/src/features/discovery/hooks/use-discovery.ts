import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/api';

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

async function fetchDiscoverLeagues(query: Record<string, string>) {
  const { data, error } = await client.get<LeaguesResponse>({
    url: '/api/v1/search/discover/leagues',
    query,
  });
  if (error) throw error;
  return data as LeaguesResponse;
}

async function fetchDiscoverContests(query: Record<string, string>) {
  const { data, error } = await client.get<ContestsResponse>({
    url: '/api/v1/search/discover/contests',
    query,
  });
  if (error) throw error;
  return data as ContestsResponse;
}

export function useTrendingLeagues(sport?: string) {
  return useQuery({
    queryKey: ['discover', 'trending-leagues', sport],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (sport && sport !== 'ALL') query.sport = sport;
      const response = await fetchDiscoverLeagues(query);
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
      const response = await fetchDiscoverContests(query);
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
      return fetchDiscoverLeagues(query);
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
      return fetchDiscoverContests(query);
    },
  });
}

export function useJoinLeague() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leagueId: string) => {
      const { data, error } = await client.post({
        url: '/api/v1/search/discover/leagues/{leagueId}/join',
        path: { leagueId },
      });
      if (error) throw error;
      return data;
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
      const [leagueData, contestData] = await Promise.all([
        fetchDiscoverLeagues({ q: query }),
        fetchDiscoverContests({ q: query }),
      ]);
      return {
        leagues: leagueData.leagues,
        contests: contestData.contests,
      };
    },
    enabled: query.trim().length >= 2,
  });
}

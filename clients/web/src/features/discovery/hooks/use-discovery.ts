import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DiscoverableContestDto,
  DiscoverableLeagueDto,
  DiscoverContestsResponse,
  DiscoverLeaguesResponse,
} from '@poolmaster/shared/dto';
import {
  DiscoverContestsResponseSchema,
  DiscoverLeaguesResponseSchema,
  LeagueMembershipResponseSchema,
} from '@poolmaster/shared/dto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { client } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export type DiscoverableLeague = DiscoverableLeagueDto;
export type DiscoverableContest = DiscoverableContestDto;

async function fetchDiscoverLeagues(query: Record<string, string>) {
  const { data, error } = await client.get<DiscoverLeaguesResponse>({
    url: API_ROUTES.search.discoverLeagues,
    query,
  });
  if (error) throw error;
  return DiscoverLeaguesResponseSchema.parse(data);
}

async function fetchDiscoverContests(query: Record<string, string>) {
  const { data, error } = await client.get<DiscoverContestsResponse>({
    url: API_ROUTES.search.discoverContests,
    query,
  });
  if (error) throw error;
  return DiscoverContestsResponseSchema.parse(data);
}

function normalizeLeagueSort(sort?: string): string | undefined {
  switch (sort) {
    case 'active':
    case 'ACTIVITY':
      return 'ACTIVITY';
    case 'newest':
    case 'NEWEST':
      return 'NEWEST';
    case 'members':
    case 'popular':
    case 'POPULAR':
      return 'POPULAR';
    default:
      return undefined;
  }
}

function normalizeContestSort(sort?: string): string | undefined {
  switch (sort) {
    case 'popular':
    case 'POPULAR':
      return 'POPULAR';
    case 'starting':
    case 'STARTING_SOON':
      return 'STARTING_SOON';
    case 'prize':
    case 'PRIZE_POOL':
      return 'PRIZE_POOL';
    default:
      return undefined;
  }
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
    if ('error' in error && typeof error.error === 'string') {
      return error.error;
    }
  }
  return 'Please try again.';
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
      const sort = normalizeLeagueSort(filters.sort);
      if (sort) query.sort = sort;
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
      const sort = normalizeContestSort(filters.sort);
      if (sort) query.sort = sort;
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
        url: API_ROUTES.search.joinDiscoverableLeague('{leagueId}'),
        path: { leagueId },
      });
      if (error) throw error;
      return LeagueMembershipResponseSchema.parse(data);
    },
    onSuccess: () => {
      toast({
        title: 'League joined',
        description: 'You are now a member of this league.',
      });
      queryClient.invalidateQueries({ queryKey: ['discover'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'leagues'] });
    },
    onError: (error) => {
      toast({
        title: 'Unable to join league',
        description: getErrorMessage(error),
      });
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

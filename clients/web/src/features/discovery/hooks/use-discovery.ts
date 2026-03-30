import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

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

// Mock data
const mockLeagues: DiscoverableLeague[] = [
  { id: 'l1', name: 'Masters Pool 2026', description: 'Annual Masters tournament pool', sport: 'GOLF', memberCount: 14, maxMembers: 20, activeContestCount: 1, activityLevel: 'HIGH', joinPolicy: 'OPEN', commissionerName: 'Dave' },
  { id: 'l2', name: 'NFL Survivor League', description: 'Pick one team per week, survive or die', sport: 'NFL', memberCount: 32, maxMembers: null, activeContestCount: 0, activityLevel: 'MEDIUM', joinPolicy: 'OPEN', commissionerName: 'Mike' },
  { id: 'l3', name: 'F1 Fantasy League', description: 'Full season F1 fantasy', sport: 'F1', memberCount: 8, maxMembers: 12, activeContestCount: 2, activityLevel: 'HIGH', joinPolicy: 'APPROVAL', commissionerName: 'Sarah' },
  { id: 'l4', name: 'March Madness Bracket', description: 'NCAA tournament bracket challenge', sport: 'NCAA_BASKETBALL', memberCount: 45, maxMembers: 100, activeContestCount: 1, activityLevel: 'HIGH', joinPolicy: 'OPEN', commissionerName: 'Tom' },
  { id: 'l5', name: 'Kentucky Derby Club', description: 'Triple Crown horse racing picks', sport: 'HORSE_RACING', memberCount: 6, maxMembers: 10, activeContestCount: 0, activityLevel: 'LOW', joinPolicy: 'OPEN', commissionerName: 'Lisa' },
  { id: 'l6', name: 'EPL Soccer Picks', description: 'Premier League weekly picks', sport: 'SOCCER', memberCount: 18, maxMembers: 24, activeContestCount: 1, activityLevel: 'HIGH', joinPolicy: 'OPEN', commissionerName: 'Alex' },
];

const mockContests: DiscoverableContest[] = [
  { id: 'c1', leagueName: 'Masters Pool 2026', contestName: 'The Masters — Pick 6', sport: 'GOLF', eventName: 'The Masters 2026', draftType: 'SNAKE', memberCount: 10, maxMembers: 20, entryFee: null, prizePool: null, draftStart: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), lockTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), status: 'OPEN' },
  { id: 'c2', leagueName: 'March Madness Bracket', contestName: 'NCAA Tournament Bracket', sport: 'NCAA_BASKETBALL', eventName: 'March Madness 2026', draftType: 'BRACKET', memberCount: 38, maxMembers: 100, entryFee: null, prizePool: null, draftStart: null, lockTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), status: 'OPEN' },
  { id: 'c3', leagueName: 'F1 Fantasy League', contestName: 'Bahrain GP — Budget Pick', sport: 'F1', eventName: 'Bahrain Grand Prix', draftType: 'BUDGET', memberCount: 6, maxMembers: 12, entryFee: null, prizePool: null, draftStart: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), lockTime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), status: 'OPEN' },
];

export function useTrendingLeagues(sport?: string) {
  return useQuery({
    queryKey: ['discover', 'trending-leagues', sport],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (sport && sport !== 'ALL') params.set('sport', sport);
        return await api.get<DiscoverableLeague[]>(`/v1/discover/leagues?${params.toString()}`);
      } catch {
        // Fallback to mock data when backend unavailable
        let results = [...mockLeagues];
        if (sport && sport !== 'ALL') results = results.filter((l) => l.sport === sport);
        return results.slice(0, 6);
      }
    },
  });
}

export function usePopularContests(sport?: string) {
  return useQuery({
    queryKey: ['discover', 'popular-contests', sport],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (sport && sport !== 'ALL') params.set('sport', sport);
        return await api.get<DiscoverableContest[]>(`/v1/discover/contests?${params.toString()}`);
      } catch {
        // Fallback to mock data when backend unavailable
        let results = [...mockContests];
        if (sport && sport !== 'ALL') results = results.filter((c) => c.sport === sport);
        return results;
      }
    },
  });
}

export function useBrowseLeagues(filters: { sport?: string; sort?: string; q?: string }) {
  return useQuery({
    queryKey: ['discover', 'leagues', filters],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (filters.sport && filters.sport !== 'ALL') params.set('sport', filters.sport);
        if (filters.sort) params.set('sort', filters.sort);
        if (filters.q) params.set('q', filters.q);
        return await api.get<{ leagues: DiscoverableLeague[]; total: number }>(`/v1/discover/leagues?${params.toString()}`);
      } catch {
        // Fallback to mock data when backend unavailable
        let results = [...mockLeagues];
        if (filters.sport && filters.sport !== 'ALL') results = results.filter((l) => l.sport === filters.sport);
        if (filters.q) {
          const q = filters.q.toLowerCase();
          results = results.filter((l) => l.name.toLowerCase().includes(q) || l.description?.toLowerCase().includes(q));
        }
        if (filters.sort === 'newest') results.reverse();
        if (filters.sort === 'members') results.sort((a, b) => b.memberCount - a.memberCount);
        return { leagues: results, total: results.length };
      }
    },
  });
}

export function useBrowseContests(filters: { sport?: string; sort?: string; q?: string }) {
  return useQuery({
    queryKey: ['discover', 'contests', filters],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (filters.sport && filters.sport !== 'ALL') params.set('sport', filters.sport);
        if (filters.sort) params.set('sort', filters.sort);
        if (filters.q) params.set('q', filters.q);
        return await api.get<{ contests: DiscoverableContest[]; total: number }>(`/v1/discover/contests?${params.toString()}`);
      } catch {
        // Fallback to mock data when backend unavailable
        let results = [...mockContests];
        if (filters.sport && filters.sport !== 'ALL') results = results.filter((c) => c.sport === filters.sport);
        if (filters.q) {
          const q = filters.q.toLowerCase();
          results = results.filter((c) => c.contestName.toLowerCase().includes(q));
        }
        return { contests: results, total: results.length };
      }
    },
  });
}

export function useJoinLeague() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (leagueId: string) => {
      try {
        return await api.post<{ success: boolean }>(`/v1/discover/leagues/${leagueId}/join`);
      } catch {
        // Fallback: simulate success when backend unavailable
        return { success: true };
      }
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
      try {
        return await api.get<{ leagues: DiscoverableLeague[]; contests: DiscoverableContest[] }>(`/v1/discover/search?q=${encodeURIComponent(query)}`);
      } catch {
        // Fallback to mock data when backend unavailable
        const q = query.toLowerCase();
        const leagues = mockLeagues.filter((l) => l.name.toLowerCase().includes(q));
        const contests = mockContests.filter((c) => c.contestName.toLowerCase().includes(q));
        return { leagues, contests };
      }
    },
    enabled: query.trim().length >= 2,
  });
}

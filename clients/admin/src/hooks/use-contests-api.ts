import { useQuery } from '@tanstack/react-query';
import { client, adminListContests, adminGetContestDetail } from '@/lib/api';
import { ContestStatus } from '@poolmaster/shared/domain';

export interface Contest {
  id: string;
  name: string;
  league: string;
  tenant: string;
  sport: string;
  sportEmoji: string;
  type: 'Single Event' | 'Season Long';
  selectionType: string;
  status: ContestStatus;
  entries: number;
  maxEntries: number;
  created: string;
}

export interface ContestEntry {
  rank: number;
  entryName: string;
  ownerEmail: string;
  totalScore: number;
}

export interface DraftPick {
  round: number;
  pick: number;
  participant: string;
  owner: string;
  autoPicked: boolean;
  time: string;
}

export interface ScoreOverride {
  admin: string;
  entry: string;
  oldScore: number;
  newScore: number;
  reason: string;
  date: string;
}

export interface ContestDetail extends Contest {
  description: string;
  standings: ContestEntry[];
  draftStatus: {
    status: string;
    currentPick: number;
    totalPicks: number;
    started: string;
  };
  picks: DraftPick[];
  overrides: ScoreOverride[];
  lastStatEvent: string;
  statEventsProcessed: number;
  corrections: number;
}

export interface ContestFilters {
  tenant?: string;
  sport?: string;
  status?: string;
  type?: string;
}

export function useContestList(filters: ContestFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'contests', filters],
    queryFn: async () => {
      const query: Record<string, string> = {};
      if (filters.tenant && filters.tenant !== 'All') query.tenant = filters.tenant;
      if (filters.sport && filters.sport !== 'All') query.sport = filters.sport;
      if (filters.status && filters.status !== 'All') query.status = filters.status;
      if (filters.type && filters.type !== 'All') query.type = filters.type;
      const { data } = await adminListContests({ client, query });
      return data;
    },
  });
}

export function useContestDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'contest', id],
    queryFn: async () => {
      const { data } = await adminGetContestDetail({ client, path: { contestId: id } });
      return data;
    },
  });
}

import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';
import { socialKeys } from './query-keys';

export interface StandingEntry {
  rank: number;
  name: string;
  initials: string;
  points: number;
  change: number;
}

export interface Highlight {
  icon: string;
  title: string;
  detail: string;
}

export interface UpcomingEvent {
  name: string;
  dateTime: string;
  daysUntil: number;
}

export interface RecapData {
  weekLabel: string;
  standings: StandingEntry[];
  highlights: Highlight[];
  upcoming: UpcomingEvent[];
}

export function useRecap(leagueId: string, weekId: string) {
  return useQuery({
    queryKey: socialKeys.recap(leagueId, weekId),
    queryFn: async (): Promise<RecapData> => {
      const { data, error } = await client.get<RecapData>({
        url: '/api/v1/social/leagues/{leagueId}/recap',
        path: { leagueId },
        query: { week: weekId },
      });
      if (error) throw error;
      return data as RecapData;
    },
  });
}

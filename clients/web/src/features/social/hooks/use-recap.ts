import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
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
      // TODO: Add /v1/social/recap to API_ROUTES once backend endpoint exists
      return await api.get<RecapData>(`/v1/social/leagues/${leagueId}/recap?week=${weekId}`);
    },
  });
}

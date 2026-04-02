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
      // TODO: migrate to generated client when backend adds this endpoint to OpenAPI spec
      return await api.get<RecapData>(`/v1/social/leagues/${leagueId}/recap?week=${weekId}`);
    },
  });
}

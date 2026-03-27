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

const mockRecap: RecapData = {
  weekLabel: 'Mar 16-22',
  standings: [
    { rank: 1, name: 'Mike T.', initials: 'MT', points: 145, change: 2 },
    { rank: 2, name: 'Sarah K.', initials: 'SK', points: 132, change: 0 },
    { rank: 3, name: 'John D.', initials: 'JD', points: 128, change: -1 },
    { rank: 4, name: 'Jane D.', initials: 'JD', points: 125, change: -1 },
  ],
  highlights: [
    { icon: '🔥', title: 'Highest Score', detail: 'Mike T. — 45 pts this week' },
    { icon: '📈', title: 'Biggest Mover', detail: 'Mike T. — up 2 spots' },
    { icon: '🎯', title: 'Closest Contest', detail: '1 point difference' },
  ],
  upcoming: [
    { name: 'NBA Playoff Draft', dateTime: '2026-03-25T19:00:00Z', daysUntil: 2 },
    { name: 'NFL Pick Lock', dateTime: '2026-03-28T13:00:00Z', daysUntil: 5 },
  ],
};

export function useRecap(leagueId: string, weekId: string) {
  return useQuery({
    queryKey: socialKeys.recap(leagueId, weekId),
    queryFn: async (): Promise<RecapData> => {
      // TODO: return api.get(`/api/leagues/${leagueId}/recap?week=${weekId}`);
      await new Promise((r) => setTimeout(r, 200));
      return mockRecap;
    },
  });
}

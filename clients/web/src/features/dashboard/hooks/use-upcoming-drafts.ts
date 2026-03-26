import { useQuery } from '@tanstack/react-query';

export interface UpcomingDraft {
  id: string;
  name: string;
  leagueName: string;
  type: 'Snake' | 'Auction' | 'Linear';
  scheduledAt: string;
}

function getTwoDaysFromNow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  return date.toISOString();
}

const mockUpcomingDrafts: UpcomingDraft[] = [
  {
    id: 'draft-1',
    name: 'NBA Fantasy Draft',
    leagueName: 'Hoops League',
    type: 'Snake',
    scheduledAt: getTwoDaysFromNow(),
  },
];

export function useUpcomingDrafts() {
  return useQuery({
    queryKey: ['dashboard', 'upcoming-drafts'],
    queryFn: async (): Promise<UpcomingDraft[]> => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return mockUpcomingDrafts;
    },
  });
}

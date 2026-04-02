import { useQuery } from '@tanstack/react-query';
import { client, getContest } from '@/lib/api';

export interface ContestEntry {
  id: string;
  entryName: string;
  ownerName: string;
  rank: number;
  score: number;
  movement: 'up' | 'down' | 'none';
  isCurrentUser: boolean;
  participants: ContestParticipant[];
}

export interface ContestParticipant {
  id: string;
  name: string;
  position: string;
  score: number;
  tier?: number;
}

export interface Contest {
  id: string;
  name: string;
  sport: string;
  sportEmoji: string;
  eventName: string;
  status: 'Open' | 'Drafting' | 'In Progress' | 'Completed';
  leagueId: string;
  leagueName: string;
  contestType: string;
  scoringType: string;
  draftType: string;
  entryDeadline: string;
  createdBy: string;
  totalEntries: number;
  myEntry: ContestEntry;
  topEntries: ContestEntry[];
}

export function useContest(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contests', contestId],
    queryFn: async (): Promise<Contest> => {
      const { data, error } = await getContest({ client, path: { contestId: contestId! } });
      if (error) throw error;
      return data as unknown as Contest;
    },
    enabled: !!contestId,
  });
}

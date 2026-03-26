import { useQuery } from '@tanstack/react-query';

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

const mockContest: Contest = {
  id: 'contest-masters-2026',
  name: 'Masters 2026 Pool',
  sport: 'Golf',
  sportEmoji: '⛳',
  eventName: 'The Masters 2026 — Apr 9-12',
  status: 'In Progress',
  leagueId: 'league-1',
  leagueName: 'Weekend Warriors',
  contestType: 'Tiered Pick',
  scoringType: 'DFS Points',
  draftType: 'Open Selection',
  entryDeadline: '2026-04-08T23:59:00Z',
  createdBy: 'Mike T.',
  totalEntries: 12,
  myEntry: {
    id: 'entry-3',
    entryName: 'My Entry',
    ownerName: 'You',
    rank: 3,
    score: 274,
    movement: 'up',
    isCurrentUser: true,
    participants: [
      { id: 'p1', name: 'Scottie Scheffler', position: 'Tier 1', score: 82, tier: 1 },
      { id: 'p2', name: 'Rory McIlroy', position: 'Tier 2', score: 71, tier: 2 },
      { id: 'p3', name: 'Collin Morikawa', position: 'Tier 3', score: 68, tier: 3 },
      { id: 'p4', name: 'Tommy Fleetwood', position: 'Tier 4', score: 53, tier: 4 },
    ],
  },
  topEntries: [
    { id: 'entry-1', entryName: 'Eagle Eye', ownerName: 'Sarah K.', rank: 1, score: 298, movement: 'none', isCurrentUser: false, participants: [] },
    { id: 'entry-2', entryName: 'Birdie Brigade', ownerName: 'Jake M.', rank: 2, score: 285, movement: 'up', isCurrentUser: false, participants: [] },
    { id: 'entry-3', entryName: 'My Entry', ownerName: 'You', rank: 3, score: 274, movement: 'up', isCurrentUser: true, participants: [] },
    { id: 'entry-4', entryName: 'Par for Course', ownerName: 'Lisa R.', rank: 4, score: 261, movement: 'down', isCurrentUser: false, participants: [] },
    { id: 'entry-5', entryName: 'Bogey Squad', ownerName: 'Tom W.', rank: 5, score: 255, movement: 'none', isCurrentUser: false, participants: [] },
  ],
};

export function useContest(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contests', contestId],
    queryFn: async (): Promise<Contest> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return mockContest;
    },
    enabled: !!contestId,
  });
}

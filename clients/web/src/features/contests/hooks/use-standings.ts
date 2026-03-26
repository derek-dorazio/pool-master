import { useQuery } from '@tanstack/react-query';

export interface StandingsEntry {
  id: string;
  rank: number;
  entryName: string;
  ownerName: string;
  totalScore: number;
  round1: number;
  round2: number;
  round3: number;
  round4: number;
  movement: 'up' | 'down' | 'none';
  movementAmount: number;
  isCurrentUser: boolean;
  isEliminated: boolean;
}

const mockStandings: StandingsEntry[] = [
  { id: 'e1', rank: 1, entryName: 'Eagle Eye', ownerName: 'Sarah K.', totalScore: 298, round1: 78, round2: 81, round3: 72, round4: 67, movement: 'none', movementAmount: 0, isCurrentUser: false, isEliminated: false },
  { id: 'e2', rank: 2, entryName: 'Birdie Brigade', ownerName: 'Jake M.', totalScore: 285, round1: 65, round2: 72, round3: 74, round4: 74, movement: 'up', movementAmount: 2, isCurrentUser: false, isEliminated: false },
  { id: 'e3', rank: 3, entryName: 'My Entry', ownerName: 'You', totalScore: 274, round1: 70, round2: 68, round3: 69, round4: 67, movement: 'up', movementAmount: 1, isCurrentUser: true, isEliminated: false },
  { id: 'e4', rank: 4, entryName: 'Par for Course', ownerName: 'Lisa R.', totalScore: 261, round1: 62, round2: 65, round3: 70, round4: 64, movement: 'down', movementAmount: 2, isCurrentUser: false, isEliminated: false },
  { id: 'e5', rank: 5, entryName: 'Bogey Squad', ownerName: 'Tom W.', totalScore: 255, round1: 60, round2: 63, round3: 66, round4: 66, movement: 'none', movementAmount: 0, isCurrentUser: false, isEliminated: false },
  { id: 'e6', rank: 6, entryName: 'Fore!', ownerName: 'Anna P.', totalScore: 248, round1: 58, round2: 62, round3: 64, round4: 64, movement: 'up', movementAmount: 1, isCurrentUser: false, isEliminated: false },
  { id: 'e7', rank: 7, entryName: 'Slice of Life', ownerName: 'Chris D.', totalScore: 241, round1: 55, round2: 60, round3: 63, round4: 63, movement: 'down', movementAmount: 1, isCurrentUser: false, isEliminated: false },
  { id: 'e8', rank: 8, entryName: 'Fairway Kings', ownerName: 'Dan H.', totalScore: 234, round1: 54, round2: 58, round3: 61, round4: 61, movement: 'none', movementAmount: 0, isCurrentUser: false, isEliminated: false },
  { id: 'e9', rank: 9, entryName: 'The Hackers', ownerName: 'Emily S.', totalScore: 220, round1: 50, round2: 55, round3: 58, round4: 57, movement: 'up', movementAmount: 2, isCurrentUser: false, isEliminated: false },
  { id: 'e10', rank: 10, entryName: 'Green Jacket', ownerName: 'Frank L.', totalScore: 210, round1: 48, round2: 52, round3: 55, round4: 55, movement: 'down', movementAmount: 1, isCurrentUser: false, isEliminated: false },
  { id: 'e11', rank: 11, entryName: 'Rough Riders', ownerName: 'Grace N.', totalScore: 195, round1: 45, round2: 48, round3: 51, round4: 51, movement: 'down', movementAmount: 2, isCurrentUser: false, isEliminated: true },
  { id: 'e12', rank: 12, entryName: 'Sand Trap', ownerName: 'Henry B.', totalScore: 180, round1: 42, round2: 44, round3: 47, round4: 47, movement: 'none', movementAmount: 0, isCurrentUser: false, isEliminated: true },
];

export function useStandings(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contests', contestId, 'standings'],
    queryFn: async (): Promise<StandingsEntry[]> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return mockStandings;
    },
    enabled: !!contestId,
  });
}

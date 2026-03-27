import { useMemo } from 'react';

export interface Contest {
  id: string;
  name: string;
  league: string;
  tenant: string;
  sport: string;
  sportEmoji: string;
  type: 'Single Event' | 'Season Long';
  selectionType: string;
  status: 'Open' | 'Drafting' | 'Active' | 'Completed' | 'Cancelled';
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

const MOCK_CONTESTS: Contest[] = [
  {
    id: 'c-001',
    name: 'NFL Sunday Showdown',
    league: 'NFL League Alpha',
    tenant: 'PoolMaster Pro',
    sport: 'NFL',
    sportEmoji: '\uD83C\uDFC8',
    type: 'Single Event',
    selectionType: 'Pick',
    status: 'Active',
    entries: 128,
    maxEntries: 256,
    created: '2026-03-01',
  },
  {
    id: 'c-002',
    name: 'NBA Season Fantasy',
    league: 'Hoops Central',
    tenant: 'PoolMaster Pro',
    sport: 'NBA',
    sportEmoji: '\uD83C\uDFC0',
    type: 'Season Long',
    selectionType: 'Draft',
    status: 'Drafting',
    entries: 12,
    maxEntries: 12,
    created: '2026-02-15',
  },
  {
    id: 'c-003',
    name: 'Masters 2026 Pool',
    league: 'Golf Majors',
    tenant: 'FanDraft',
    sport: 'Golf',
    sportEmoji: '\u26F3',
    type: 'Single Event',
    selectionType: 'Pick',
    status: 'Open',
    entries: 45,
    maxEntries: 100,
    created: '2026-03-10',
  },
  {
    id: 'c-004',
    name: 'F1 Constructor Cup',
    league: 'F1 Predictions',
    tenant: 'RaceFan',
    sport: 'F1',
    sportEmoji: '\uD83C\uDFCE\uFE0F',
    type: 'Season Long',
    selectionType: 'Draft',
    status: 'Active',
    entries: 8,
    maxEntries: 10,
    created: '2026-01-20',
  },
  {
    id: 'c-005',
    name: 'March Madness Bracket',
    league: 'NCAA Tourney',
    tenant: 'PoolMaster Pro',
    sport: 'NCAA',
    sportEmoji: '\uD83C\uDFC0',
    type: 'Single Event',
    selectionType: 'Bracket',
    status: 'Completed',
    entries: 256,
    maxEntries: 256,
    created: '2026-03-15',
  },
  {
    id: 'c-006',
    name: 'Premier League Weekly',
    league: 'Soccer Central',
    tenant: 'FanDraft',
    sport: 'Soccer',
    sportEmoji: '\u26BD',
    type: 'Single Event',
    selectionType: 'Pick',
    status: 'Active',
    entries: 64,
    maxEntries: 128,
    created: '2026-02-28',
  },
  {
    id: 'c-007',
    name: 'Kentucky Derby 2026',
    league: 'Horse Racing Elite',
    tenant: 'RaceFan',
    sport: 'Horse Racing',
    sportEmoji: '\uD83C\uDFC7',
    type: 'Single Event',
    selectionType: 'Pick',
    status: 'Open',
    entries: 32,
    maxEntries: 50,
    created: '2026-03-20',
  },
  {
    id: 'c-008',
    name: 'Daytona Survivor Pool',
    league: 'NASCAR Pools',
    tenant: 'PoolMaster Pro',
    sport: 'NASCAR',
    sportEmoji: '\uD83C\uDFCE\uFE0F',
    type: 'Single Event',
    selectionType: 'Survivor',
    status: 'Cancelled',
    entries: 18,
    maxEntries: 50,
    created: '2026-02-01',
  },
];

function buildContestDetail(contest: Contest): ContestDetail {
  return {
    ...contest,
    description: `A ${contest.type.toLowerCase()} contest for ${contest.sport} fans.`,
    standings: [
      { rank: 1, entryName: 'Dream Team', ownerEmail: 'alice@example.com', totalScore: 245 },
      { rank: 2, entryName: 'Underdogs', ownerEmail: 'bob@example.com', totalScore: 232 },
      { rank: 3, entryName: 'All Stars', ownerEmail: 'carol@example.com', totalScore: 228 },
      { rank: 4, entryName: 'Comeback Kids', ownerEmail: 'dave@example.com', totalScore: 215 },
      { rank: 5, entryName: 'The Analysts', ownerEmail: 'emma@example.com', totalScore: 209 },
      { rank: 6, entryName: 'Lucky Picks', ownerEmail: 'frank@example.com', totalScore: 198 },
      { rank: 7, entryName: 'Dark Horses', ownerEmail: 'grace@example.com', totalScore: 187 },
      { rank: 8, entryName: 'The Rookies', ownerEmail: 'hank@example.com', totalScore: 174 },
    ],
    draftStatus: {
      status: 'In Progress',
      currentPick: 47,
      totalPicks: 96,
      started: '2026-03-22T14:00:00Z',
    },
    picks: [
      { round: 1, pick: 1, participant: 'Patrick Mahomes', owner: 'alice@example.com', autoPicked: false, time: '14:00:12' },
      { round: 1, pick: 2, participant: 'Nikola Jokic', owner: 'bob@example.com', autoPicked: false, time: '14:01:45' },
      { round: 1, pick: 3, participant: 'Scottie Scheffler', owner: 'carol@example.com', autoPicked: true, time: '14:03:00' },
      { round: 1, pick: 4, participant: 'Max Verstappen', owner: 'dave@example.com', autoPicked: false, time: '14:04:22' },
      { round: 2, pick: 5, participant: 'Travis Kelce', owner: 'dave@example.com', autoPicked: false, time: '14:05:10' },
      { round: 2, pick: 6, participant: 'Luka Doncic', owner: 'carol@example.com', autoPicked: false, time: '14:06:33' },
      { round: 2, pick: 7, participant: 'Rory McIlroy', owner: 'bob@example.com', autoPicked: true, time: '14:08:00' },
      { round: 2, pick: 8, participant: 'Lewis Hamilton', owner: 'alice@example.com', autoPicked: false, time: '14:09:15' },
    ],
    overrides: [
      {
        admin: 'admin@poolmaster.io',
        entry: 'Dream Team',
        oldScore: 240,
        newScore: 245,
        reason: 'Stat correction: missed touchdown',
        date: '2026-03-24',
      },
      {
        admin: 'admin@poolmaster.io',
        entry: 'Lucky Picks',
        oldScore: 202,
        newScore: 198,
        reason: 'Duplicate scoring event removed',
        date: '2026-03-23',
      },
    ],
    lastStatEvent: '2 minutes ago',
    statEventsProcessed: 1245,
    corrections: 3,
  };
}

export interface ContestFilters {
  tenant?: string;
  sport?: string;
  status?: string;
  type?: string;
}

export function useContestList(filters: ContestFilters = {}) {
  const data = useMemo(() => {
    let result = [...MOCK_CONTESTS];
    if (filters.tenant && filters.tenant !== 'All') {
      result = result.filter((c) => c.tenant === filters.tenant);
    }
    if (filters.sport && filters.sport !== 'All') {
      result = result.filter((c) => c.sport === filters.sport);
    }
    if (filters.status && filters.status !== 'All') {
      result = result.filter((c) => c.status === filters.status);
    }
    if (filters.type && filters.type !== 'All') {
      result = result.filter((c) => c.type === filters.type);
    }
    return result;
  }, [filters.tenant, filters.sport, filters.status, filters.type]);

  return { data, isLoading: false };
}

export function useContestDetail(id: string) {
  const data = useMemo(() => {
    const contest = MOCK_CONTESTS.find((c) => c.id === id) ?? MOCK_CONTESTS[0];
    return buildContestDetail(contest);
  }, [id]);

  return { data, isLoading: false };
}

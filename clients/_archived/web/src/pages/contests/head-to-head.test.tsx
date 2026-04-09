import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as HeadToHeadPage } from './head-to-head';

const mockStandings = {
  standings: [
    {
      rank: 1,
      entryId: 'entry-1',
      entryName: 'Alpha Entry',
      ownerDisplayName: 'Alice',
      ownerId: 'user-1',
      totalScore: 50,
      previousRank: null,
      movement: 'same' as const,
      isEliminated: false,
      lastUpdatedAt: '2026-04-03T10:00:00Z',
    },
    {
      rank: 2,
      entryId: 'entry-2',
      entryName: 'Beta Entry',
      ownerDisplayName: 'Bob',
      ownerId: 'user-2',
      totalScore: 42,
      previousRank: null,
      movement: 'same' as const,
      isEliminated: false,
      lastUpdatedAt: '2026-04-03T10:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
  contestId: 'contest-1',
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ contestId: 'contest-1' }),
  };
});

vi.mock('@/features/contests/hooks/use-standings', () => ({
  useStandings: () => ({
    data: mockStandings,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@/features/contests/hooks/use-contest', () => ({
  useContest: () => ({
    data: {
      contest: {
        id: 'contest-1',
        name: 'NFL Weekly Pickem',
        status: 'ACTIVE',
        contestType: 'SINGLE_EVENT',
        selectionType: 'PICK_EM',
        scoringEngine: 'CUMULATIVE',
        leagueId: 'league-1',
      },
      selectionConfig: null,
    },
  }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) => {
      const entryId = options.queryKey[3];
      if (entryId === 'entry-1') {
        return {
          data: {
            entryId: 'entry-1',
            contestId: 'contest-1',
            totalScore: 50,
            timeline: [
              {
                contestId: 'contest-1',
                entryId: 'entry-1',
                eventTimestamp: '2026-04-03T10:00:00Z',
                pointsEarned: 50,
                runningTotal: 50,
                participantBreakdowns: [
                  {
                    participantId: 'participant-1',
                    participantName: 'Scottie Scheffler',
                    contextLabel: 'Week 5 Game 3',
                    statPoints: 10,
                    positionPoints: 0,
                    bonusPoints: 0,
                    penaltyPoints: 0,
                    multipliedTotal: 10,
                    dnfAdjustment: 0,
                    finalScore: 10,
                  },
                ],
              },
            ],
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      if (entryId === 'entry-2') {
        return {
          data: {
            entryId: 'entry-2',
            contestId: 'contest-1',
            totalScore: 42,
            timeline: [
              {
                contestId: 'contest-1',
                entryId: 'entry-2',
                eventTimestamp: '2026-04-03T10:00:00Z',
                pointsEarned: 42,
                runningTotal: 42,
                participantBreakdowns: [
                  {
                    participantId: 'participant-2',
                    participantName: 'Rory McIlroy',
                    contextLabel: 'Week 5 Game 4',
                    statPoints: 8,
                    positionPoints: 0,
                    bonusPoints: 0,
                    penaltyPoints: 0,
                    multipliedTotal: 8,
                    dnfAdjustment: 0,
                    finalScore: 8,
                  },
                ],
              },
            ],
          },
          isLoading: false,
          isError: false,
          error: null,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        error: null,
      };
    },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <HeadToHeadPage />
    </MemoryRouter>,
  );
}

describe('HeadToHeadPage', () => {
  it('renders comparison using persisted standings and score timelines', () => {
    renderPage();

    expect(screen.getByText('NFL Weekly Pickem')).toBeInTheDocument();
    expect(screen.getByText("Pick'em Head-to-Head")).toBeInTheDocument();
    expect(screen.getByText(/pick'em scoring timelines/i)).toBeInTheDocument();
    expect(screen.getByText('Alpha Entry')).toBeInTheDocument();
    expect(screen.getByText('Beta Entry')).toBeInTheDocument();
    expect(screen.getByText('+8')).toBeInTheDocument();
    expect(screen.getByText('Scottie Scheffler')).toBeInTheDocument();
    expect(screen.getByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.getByText('Week 5 Game 3')).toBeInTheDocument();
    expect(screen.getByText('Week 5 Game 4')).toBeInTheDocument();
    expect(screen.getAllByText('Selection contribution').length).toBeGreaterThan(0);
    expect(screen.getByText("Pick'em Entry 1")).toBeInTheDocument();
    expect(screen.getByText("Pick'em Entry 2")).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestScoringPage } from './scoring';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ contestId: 'contest-1' }),
  };
});

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

vi.mock('@/features/contests/hooks/use-standings', () => ({
  useStandings: () => ({
    data: {
      standings: [
        {
          rank: 1,
          entryId: 'entry-1',
          entryName: 'Alpha Entry',
          ownerDisplayName: 'Alice',
          ownerId: 'user-1',
          totalScore: 50,
          previousRank: null,
          movement: 'same',
          isEliminated: false,
          lastUpdatedAt: '2026-04-03T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      contestId: 'contest-1',
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) => {
      const key = options.queryKey[2];
      if (key === 'entry-score') {
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
                pointsEarned: 10,
                runningTotal: 10,
                participantBreakdowns: [
                  {
                    participantId: 'participant-1',
                    participantName: 'Bills',
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
      return actual.useQuery(options);
    },
  };
});

describe('ContestScoringPage', () => {
  it("uses mode-aware pick'em scoring labels", () => {
    render(
      <MemoryRouter>
        <ContestScoringPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("NFL Weekly Pickem")).toBeInTheDocument();
    expect(screen.getByText("Pick'em Score Breakdown")).toBeInTheDocument();
    expect(screen.getByText(/timeline of persisted scores for saved predictions/i)).toBeInTheDocument();
    expect(screen.getByText('Prediction Timeline')).toBeInTheDocument();
    expect(screen.getByText('Selection Contributions')).toBeInTheDocument();
    expect(screen.getByLabelText("Select Pick'em Entry")).toBeInTheDocument();
  });
});

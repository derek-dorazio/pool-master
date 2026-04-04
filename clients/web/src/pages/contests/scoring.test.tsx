import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ContestScoringPage } from './scoring';

let contestId = 'contest-1';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ contestId }),
  };
});

vi.mock('@/features/contests/hooks/use-contest', () => ({
  useContest: () => ({
    data: {
      contest: {
        id: contestId,
        name: contestId === 'contest-1' ? 'NFL Weekly Pickem' : 'March Madness Bracket',
        status: 'ACTIVE',
        contestType: 'SINGLE_EVENT',
        selectionType: contestId === 'contest-1' ? 'PICK_EM' : 'BRACKET_PICK_EM',
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
      standings: contestId === 'contest-1'
        ? [
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
      ]
        : [
        {
          rank: 1,
          entryId: 'entry-2',
          entryName: 'Beta Bracket',
          ownerDisplayName: 'Bob',
          ownerId: 'user-2',
          totalScore: 65,
          previousRank: null,
          movement: 'same',
          isEliminated: false,
          lastUpdatedAt: '2026-04-03T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      contestId,
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
      const selectedEntry = options.queryKey[3];
      if (key === 'entry-score') {
        return {
          data: {
            entryId: selectedEntry,
            contestId: options.queryKey[1],
            totalScore: contestId === 'contest-1' ? 50 : 65,
            timeline: [
              {
                contestId: options.queryKey[1],
                entryId: selectedEntry,
                eventTimestamp: '2026-04-03T10:00:00Z',
                pointsEarned: 10,
                runningTotal: 10,
                participantBreakdowns: [
                  {
                    participantId: 'participant-1',
                    participantName: 'Bills',
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
      return actual.useQuery(options);
    },
  };
});

describe('ContestScoringPage', () => {
  it("uses mode-aware pick'em scoring labels", () => {
    contestId = 'contest-1';

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
    expect(screen.getByText('Week 5 Game 3')).toBeInTheDocument();
  });

  it('resets the selected entry when navigating to another contest', () => {
    contestId = 'contest-1';

    const { rerender } = render(
      <MemoryRouter>
        <ContestScoringPage />
      </MemoryRouter>,
    );

    expect(screen.getByDisplayValue('Alpha Entry (Alice)')).toBeInTheDocument();

    contestId = 'contest-2';
    rerender(
      <MemoryRouter>
        <ContestScoringPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Bracket Score Breakdown')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Bracket Entry')).toHaveValue('entry-2');
    expect(screen.getByDisplayValue('Beta Bracket (Bob)')).toBeInTheDocument();
  });
});

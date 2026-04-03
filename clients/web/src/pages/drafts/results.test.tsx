import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as DraftResultsPage } from './results';

let mockDraftState = {
  contestId: 'contest-1',
  contestName: 'Masters 2026',
  selectionType: 'SNAKE_DRAFT',
  status: 'COMPLETE',
  currentPickNumber: 9,
  currentRound: 3,
  totalPicks: 8,
  totalRounds: 4,
  currentEntryId: null,
  currentEntryName: null,
  myEntryId: 'entry-1',
  isMyPick: false,
  timePerPickSeconds: 90,
  pickDeadline: null,
  availableParticipantIds: [],
  isComplete: true,
  entries: [
    { id: 'entry-1', userId: 'user-1', name: 'My Team', isOnClock: false },
    { id: 'entry-2', userId: 'user-2', name: 'Team Alpha', isOnClock: false },
  ],
  picks: [
    {
      pickNumber: 1,
      round: 1,
      pickInRound: 1,
      entryId: 'entry-1',
      entryName: 'My Team',
      participantId: 'p1',
      participantName: 'S. Scheffler',
      position: 'G',
      team: 'USA',
      autoPicked: false,
      pickedAt: new Date().toISOString(),
    },
  ],
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ draftId: 'draft-1' }) };
});

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => ({
      data: mockDraftState,
      isLoading: false,
    }),
  };
});

describe('DraftResultsPage', () => {
  beforeEach(() => {
    mockDraftState = {
      contestId: 'contest-1',
      contestName: 'Masters 2026',
      selectionType: 'SNAKE_DRAFT',
      status: 'COMPLETE',
      currentPickNumber: 9,
      currentRound: 3,
      totalPicks: 8,
      totalRounds: 4,
      currentEntryId: null,
      currentEntryName: null,
      myEntryId: 'entry-1',
      isMyPick: false,
      timePerPickSeconds: 90,
      pickDeadline: null,
      availableParticipantIds: [],
      isComplete: true,
      entries: [
        { id: 'entry-1', userId: 'user-1', name: 'My Team', isOnClock: false },
        { id: 'entry-2', userId: 'user-2', name: 'Team Alpha', isOnClock: false },
      ],
      picks: [
        {
          pickNumber: 1,
          round: 1,
          pickInRound: 1,
          entryId: 'entry-1',
          entryName: 'My Team',
          participantId: 'p1',
          participantName: 'S. Scheffler',
          position: 'G',
          team: 'USA',
          autoPicked: false,
          pickedAt: new Date().toISOString(),
        },
      ],
    };
  });

  it('renders truthful draft results without fabricated recap analytics', () => {
    render(
      <MemoryRouter>
        <DraftResultsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Masters 2026 - Draft Results')).toBeInTheDocument();
    expect(screen.getByText('All Picks')).toBeInTheDocument();
    expect(screen.getByText('Entry Rosters')).toBeInTheDocument();
    expect(screen.getByText('Current Draft State')).toBeInTheDocument();
    expect(screen.queryByText('Best Value')).not.toBeInTheDocument();
    expect(screen.queryByText('Biggest Reaches')).not.toBeInTheDocument();
  });

  it('uses mode-aware labels for pickem results', () => {
    mockDraftState = {
      ...mockDraftState,
      contestName: 'NFL Weekly Pickem',
      selectionType: 'PICK_EM',
      currentPickNumber: 3,
      currentRound: 2,
      totalPicks: 4,
      picks: [
        {
          pickNumber: 1,
          round: 2,
          pickInRound: 1,
          entryId: 'entry-1',
          entryName: 'My Team',
          participantId: 'team-1',
          participantName: 'Bills',
          position: undefined,
          team: 'BUF',
          autoPicked: false,
          pickedAt: new Date().toISOString(),
        },
      ],
    };

    render(
      <MemoryRouter>
        <DraftResultsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("NFL Weekly Pickem - Pick'em Results")).toBeInTheDocument();
    expect(screen.getByText('All Predictions')).toBeInTheDocument();
    expect(screen.getByText('Entry Predictions')).toBeInTheDocument();
    expect(screen.getByText("Current Pick'em State")).toBeInTheDocument();
    expect(screen.getAllByText('Selection').length).toBeGreaterThan(0);
  });
});

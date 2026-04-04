import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DraftStateResponse } from '@poolmaster/shared/dto';
import { Component as DraftResultsPage } from './results';

let mockDraftState: DraftStateResponse = {
  contestId: 'contest-1',
  contestName: 'Masters 2026',
  selectionType: 'SNAKE_DRAFT',
  isTurnBased: true,
  rosterSize: 4,
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
      isTurnBased: true,
      rosterSize: 4,
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
          position: '',
          team: 'BUF',
          autoPicked: false,
          pickedAt: new Date().toISOString(),
        },
      ],
      pickEmEvents: [
        {
          id: 'matchup-1',
          eventId: 'event-1',
          period: 2,
          matchupIndex: 1,
          homeParticipantId: 'team-2',
          homeParticipantName: 'Chiefs',
          awayParticipantId: 'team-1',
          awayParticipantName: 'Bills',
          eventTime: new Date().toISOString(),
          deadline: new Date().toISOString(),
          isLocked: false,
          myPickParticipantId: 'team-1',
          confidenceWeight: 1,
          label: 'Bills at Chiefs',
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
    expect(screen.getAllByText('Bills at Chiefs').length).toBeGreaterThan(0);
  });

  it('shows bracket matchup context from the live room contract', () => {
    mockDraftState = {
      ...mockDraftState,
      contestName: 'March Bracket',
      selectionType: 'BRACKET_PICK_EM',
      currentPickNumber: 2,
      currentRound: 1,
      totalPicks: 1,
      picks: [
        {
          pickNumber: 1,
          round: 1,
          pickInRound: 1,
          entryId: 'entry-1',
          entryName: 'My Team',
          participantId: 'team-1',
          participantName: 'Duke',
          position: '',
          team: 'DUK',
          autoPicked: false,
          pickedAt: new Date().toISOString(),
        },
      ],
      bracketMatchups: [
        {
          id: 'bracket-1',
          roundNumber: 1,
          matchNumber: 1,
          label: 'East Regional 1',
          isLocked: false,
          topTeam: { id: 'team-1', name: 'Duke', seed: 1 },
          bottomTeam: { id: 'team-2', name: 'VCU', seed: 8 },
          winnerId: 'team-1',
        },
      ],
    };

    render(
      <MemoryRouter>
        <DraftResultsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('March Bracket - Bracket Results')).toBeInTheDocument();
    expect(screen.getByText('Entry Brackets')).toBeInTheDocument();
    expect(screen.getAllByText('East Regional 1').length).toBeGreaterThan(0);
  });

  it('shows budget setup and spend context for budget contests', () => {
    mockDraftState = {
      ...mockDraftState,
      contestName: 'Masters Salary Pool',
      selectionType: 'BUDGET_PICK',
      isTurnBased: false,
      rosterSize: 6,
      currentPickNumber: 4,
      currentRound: 4,
      selectionConfig: {
        isExclusive: false,
        budget: 50000,
        pricingMethod: 'ODDS',
        rosterSize: 6,
      },
      picks: [
        {
          pickNumber: 1,
          round: 1,
          pickInRound: 1,
          entryId: 'entry-1',
          entryName: 'My Team',
          participantId: 'p1',
          participantName: 'S. Scheffler',
          position: '',
          team: 'USA',
          price: 18000,
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

    expect(screen.getByText('Masters Salary Pool - Budget Results')).toBeInTheDocument();
    expect(screen.getByText('All Budget Selections')).toBeInTheDocument();
    expect(screen.getByText('Entry Budget Cards')).toBeInTheDocument();
    expect(screen.getByText('Current Budget State')).toBeInTheDocument();
    expect(screen.getAllByText('Odds').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$18,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Budget Pick').length).toBeGreaterThan(0);
  });

  it('shows tier setup and tier labels for tiered contests', () => {
    mockDraftState = {
      ...mockDraftState,
      contestName: 'Masters Tier Pool',
      selectionType: 'TIERED',
      isTurnBased: false,
      rosterSize: 6,
      currentPickNumber: 2,
      currentRound: 2,
      selectionConfig: {
        isExclusive: false,
        rosterSize: 6,
        tierConfig: Array.from({ length: 6 }, (_, index) => ({
          tierId: `tier-${index + 1}`,
          tierName: `Tier ${index + 1}`,
          tierNumber: index + 1,
          picksFromTier: 1,
        })),
      },
      picks: [
        {
          pickNumber: 1,
          round: 1,
          pickInRound: 1,
          entryId: 'entry-1',
          entryName: 'My Team',
          participantId: 'p1',
          participantName: 'S. Scheffler',
          position: '',
          team: 'USA',
          tierName: 'Tier 1',
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

    expect(screen.getByText('Masters Tier Pool - Tiered Results')).toBeInTheDocument();
    expect(screen.getByText('All Tiered Selections')).toBeInTheDocument();
    expect(screen.getByText('Entry Tier Cards')).toBeInTheDocument();
    expect(screen.getByText('Current Tiered State')).toBeInTheDocument();
    expect(screen.getAllByText('Tier 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tier Count').length).toBeGreaterThan(0);
  });
});

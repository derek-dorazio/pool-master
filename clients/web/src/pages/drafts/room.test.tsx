import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Component as DraftRoomPage } from './room';
import type { AvailableParticipant, DraftState } from '@/features/draft-room/hooks/use-draft';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ draftId: 'test-draft' }),
  };
});

const mockMutate = vi.fn();
let mockDraftReturn: { data: DraftState | undefined; isLoading: boolean; error: Error | null };

vi.mock('@/features/draft-room/hooks/use-draft', () => ({
  useDraft: () => mockDraftReturn,
  useAvailableParticipants: () => ({ data: [], isLoading: false }),
  useMakePick: () => ({ mutate: mockMutate, isPending: false }),
  useResetBracket: () => ({ mutate: mockMutate, isPending: false }),
  useAutoFillBracket: () => ({ mutate: mockMutate, isPending: false }),
}));

vi.mock('@/features/draft-room/draft-header', () => ({
  DraftHeader: (props: { draft: DraftState }) => (
    <div data-testid="draft-header">{props.draft.contestName}</div>
  ),
}));

const mockAvailableParticipant: AvailableParticipant = {
  id: 'p2',
  name: 'R. McIlroy',
  position: 'G',
  team: 'IRL',
  ranking: 2,
  formRating: 8.7,
  injuryStatus: 'ACTIVE',
};

vi.mock('@/features/draft-room/available-panel', () => ({
  AvailablePanel: (props: {
    onDraft: (participantId: string) => void;
    onSelect: (participant: AvailableParticipant | null) => void;
  }) => (
    <div data-testid="available-panel">
      <button type="button" onClick={() => props.onDraft('p2')}>
        trigger-draft
      </button>
      <button type="button" onClick={() => props.onSelect(mockAvailableParticipant)}>
        select-participant
      </button>
    </div>
  ),
}));

vi.mock('@/features/draft-room/pick-board', () => ({
  PickBoard: () => <div data-testid="pick-board" />,
}));

vi.mock('@/features/draft-room/roster-panel', () => ({
  RosterPanel: () => <div data-testid="roster-panel" />,
}));

vi.mock('@/features/draft-room/tiered-board', () => ({
  TieredBoard: () => <div data-testid="tiered-board" />,
}));

vi.mock('@/features/draft-room/selection-overview', () => ({
  SelectionOverview: () => <div data-testid="selection-overview" />,
}));

vi.mock('@/features/draft-room/pickem-panel', () => ({
  PickEmPanel: (props: {
    onPick: (eventId: string, side: 'home' | 'away') => void;
    onConfidence: (eventId: string, points: number) => void;
  }) => (
    <div data-testid="pickem-panel">
      <button type="button" onClick={() => props.onPick('matchup-1', 'home')}>
        make-pickem-pick
      </button>
      <button type="button" onClick={() => props.onConfidence('matchup-1', 7)}>
        set-confidence
      </button>
    </div>
  ),
}));

vi.mock('@/features/draft-room/bracket-panel', () => ({
  BracketPanel: (props: {
    onPickWinner: (matchupId: string, winnerId: string) => void;
    onReset: () => void;
    onAutoFill: () => void;
  }) => (
    <div data-testid="bracket-panel">
      <button type="button" onClick={() => props.onPickWinner('bracket-1', 'team-1')}>
        make-bracket-pick
      </button>
      <button type="button" onClick={props.onReset}>
        reset-bracket
      </button>
      <button type="button" onClick={props.onAutoFill}>
        autofill-bracket
      </button>
    </div>
  ),
}));

vi.mock('@/features/draft-room/commissioner-controls', () => ({
  CommissionerControls: () => <div data-testid="commissioner-controls" />,
}));

vi.mock('@/features/social/chat-panel', () => ({
  ChatPanel: (props: { contestId: string }) => (
    <div data-testid="chat-panel">Chat for {props.contestId}</div>
  ),
}));

const mockDraft: DraftState = {
  contestId: 'contest-1',
  contestName: 'Masters 2026',
  selectionType: 'SNAKE_DRAFT',
  isTurnBased: true,
  rosterSize: 4,
  selectionConfig: { isExclusive: true, rounds: 4, rosterSize: 4 },
  status: 'LIVE' as DraftState['status'],
  currentPickNumber: 3,
  totalPicks: 24,
  currentRound: 1,
  totalRounds: 4,
  currentEntryId: 'entry-1',
  currentEntryName: 'My Team',
  myEntryId: 'entry-1',
  isMyPick: true,
  timePerPickSeconds: 90,
  pickDeadline: new Date(Date.now() + 60000).toISOString(),
  availableParticipantIds: ['p2', 'p3'],
  isComplete: false,
  entries: [
    { id: 'entry-1', name: 'My Team', userId: 'me', isOnClock: true },
    { id: 'entry-2', name: 'Team Alpha', userId: 'u2', isOnClock: false },
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/drafts/test-draft']}>
      <Routes>
        <Route path="/drafts/:draftId" element={<DraftRoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DraftRoomPage', () => {
  beforeEach(() => {
    mockDraftReturn = { data: mockDraft, isLoading: false, error: null };
    mockMutate.mockClear();
  });

  it('renders loading state when draft data is loading', () => {
    mockDraftReturn = { data: undefined, isLoading: true, error: null };
    renderPage();

    expect(screen.getByText('Loading draft room...')).toBeInTheDocument();
  });

  it('renders DraftHeader component', () => {
    renderPage();

    expect(screen.getByTestId('draft-header')).toBeInTheDocument();
  });

  it('renders AvailablePanel component', () => {
    renderPage();

    expect(screen.getByTestId('available-panel')).toBeInTheDocument();
  });

  it('renders PickBoard component', () => {
    renderPage();

    expect(screen.getByTestId('pick-board')).toBeInTheDocument();
  });

  it('renders RosterPanel component', () => {
    renderPage();

    expect(screen.getByTestId('roster-panel')).toBeInTheDocument();
  });

  it('shows draft room layout with main content area', () => {
    renderPage();

    expect(screen.getByTestId('draft-header')).toBeInTheDocument();
    expect(screen.getByTestId('commissioner-controls')).toBeInTheDocument();
    expect(screen.getByTestId('pick-board')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toHaveTextContent('Chat for contest-1');
  });

  it('shows an honest unavailable state when the draft has an error', () => {
    mockDraftReturn = { data: undefined, isLoading: false, error: new Error('Not found') };
    renderPage();

    expect(screen.getByText('Draft room unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Contest/ })).toBeInTheDocument();
  });

  it('does not crash when draft status is COMPLETE', () => {
    mockDraftReturn = {
      data: { ...mockDraft, status: 'COMPLETE' as DraftState['status'] },
      isLoading: false,
      error: null,
    };
    renderPage();

    expect(screen.getByTestId('draft-header')).toBeInTheDocument();
    expect(screen.getByTestId('pick-board')).toBeInTheDocument();
  });

  it('renders tiered board for tiered contests', () => {
    mockDraftReturn = {
      data: {
        ...mockDraft,
        selectionType: 'TIERED',
        isTurnBased: false,
        selectionConfig: {
          isExclusive: false,
          rosterSize: 4,
          tierConfig: [
            { tierId: 'Tier 1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 1 },
          ],
        },
      },
      isLoading: false,
      error: null,
    };

    renderPage();

    expect(screen.getByTestId('tiered-board')).toBeInTheDocument();
  });

  it('renders selection overview for non-turn-based open selection contests', () => {
    mockDraftReturn = {
      data: {
        ...mockDraft,
        selectionType: 'OPEN_SELECTION',
        isTurnBased: false,
        selectionConfig: { isExclusive: false, pickCount: 4, rosterSize: 4 },
      },
      isLoading: false,
      error: null,
    };

    renderPage();

    expect(screen.getByTestId('selection-overview')).toBeInTheDocument();
  });

  it('renders pickem panel for pickem contests', () => {
    mockDraftReturn = {
      data: {
        ...mockDraft,
        selectionType: 'PICK_EM',
        isTurnBased: false,
        selectionConfig: { isExclusive: false, picksPerPeriod: 2, rosterSize: 2 },
        pickEmEvents: [
          {
            id: 'matchup-1',
            eventId: 'event-1',
            period: 1,
            matchupIndex: 1,
            homeParticipantId: 'home-1',
            homeParticipantName: 'Home',
            awayParticipantId: 'away-1',
            awayParticipantName: 'Away',
            eventTime: new Date().toISOString(),
            deadline: new Date(Date.now() + 60_000).toISOString(),
            isLocked: false,
            myPickParticipantId: null,
            confidenceWeight: null,
            label: 'Game 1',
          },
        ],
      },
      isLoading: false,
      error: null,
    };

    renderPage();

    expect(screen.getByTestId('pickem-panel')).toBeInTheDocument();
  });

  it('renders bracket panel for bracket contests', () => {
    mockDraftReturn = {
      data: {
        ...mockDraft,
        selectionType: 'BRACKET_PICK_EM',
        isTurnBased: false,
        selectionConfig: { isExclusive: false, roundValues: [1, 2, 4] },
        bracketMatchups: [
          {
            id: 'bracket-1',
            roundNumber: 1,
            matchNumber: 1,
            label: 'Round 1 Match 1',
            isLocked: false,
            topTeam: { id: 'team-1', name: 'Team 1', seed: 1 },
            bottomTeam: { id: 'team-2', name: 'Team 2', seed: 16 },
            winnerId: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    };

    renderPage();

    expect(screen.getByTestId('bracket-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('available-panel')).not.toBeInTheDocument();
  });

  it('shows an entry-required state when the user does not have a contest entry', () => {
    mockDraftReturn = {
      data: {
        ...mockDraft,
        myEntryId: null,
        currentEntryId: null,
        currentEntryName: null,
        isMyPick: false,
      },
      isLoading: false,
      error: null,
    };

    renderPage();

    expect(screen.getByText('Contest entry required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create or join your entry/ })).toBeInTheDocument();
    expect(screen.queryByTestId('pick-board')).not.toBeInTheDocument();
  });

  it('opens the confirmation dialog and submits a turn-based pick', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'trigger-draft' }));

    expect(screen.getByText('Confirm Pick')).toBeInTheDocument();
    expect(screen.getByText('Draft this participant with pick #3?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mockMutate).toHaveBeenCalledWith({
      entryId: 'entry-1',
      participantId: 'p2',
    });
  });

  it('shows the participant drawer from the available panel selection', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'select-participant' }));

    expect(screen.getByText('R. McIlroy')).toBeInTheDocument();
    expect(screen.getByText(/Ranking:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft R. McIlroy' })).toBeInTheDocument();
  });

  it('closes the participant drawer after confirming a real-entry pick', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'select-participant' }));
    await user.click(screen.getByRole('button', { name: 'Draft R. McIlroy' }));

    expect(screen.getByText('Confirm Pick')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mockMutate).toHaveBeenCalledWith({
      entryId: 'entry-1',
      participantId: 'p2',
    });
    expect(screen.queryByText('Confirm Pick')).not.toBeInTheDocument();
    expect(screen.queryByText('R. McIlroy')).not.toBeInTheDocument();
  });

  it('submits pickem picks and confidence weights through the room handlers', async () => {
    const user = userEvent.setup();
    mockDraftReturn = {
      data: {
        ...mockDraft,
        selectionType: 'PICK_EM',
        isTurnBased: false,
        selectionConfig: { isExclusive: false, picksPerPeriod: 2, rosterSize: 2 },
        pickEmEvents: [
          {
            id: 'matchup-1',
            eventId: 'event-1',
            period: 1,
            matchupIndex: 1,
            homeParticipantId: 'home-1',
            homeParticipantName: 'Home',
            awayParticipantId: 'away-1',
            awayParticipantName: 'Away',
            eventTime: new Date().toISOString(),
            deadline: new Date(Date.now() + 60_000).toISOString(),
            isLocked: false,
            myPickParticipantId: 'home-1',
            confidenceWeight: 3,
            label: 'Game 1',
          },
        ],
      },
      isLoading: false,
      error: null,
    };

    renderPage();

    await user.click(screen.getByRole('button', { name: 'make-pickem-pick' }));
    await user.click(screen.getByRole('button', { name: 'set-confidence' }));

    expect(mockMutate).toHaveBeenNthCalledWith(1, {
      entryId: 'entry-1',
      participantId: 'home-1',
      eventId: 'event-1',
      matchupIndex: 1,
      period: 1,
    });
    expect(mockMutate).toHaveBeenNthCalledWith(2, {
      entryId: 'entry-1',
      participantId: 'home-1',
      eventId: 'event-1',
      matchupIndex: 1,
      period: 1,
      confidenceWeight: 7,
    });
  });

  it('submits bracket actions through the room handlers', async () => {
    const user = userEvent.setup();
    mockDraftReturn = {
      data: {
        ...mockDraft,
        selectionType: 'BRACKET_PICK_EM',
        isTurnBased: false,
        selectionConfig: { isExclusive: false, roundValues: [1, 2, 4] },
        bracketMatchups: [
          {
            id: 'bracket-1',
            roundNumber: 1,
            matchNumber: 1,
            label: 'Round 1 Match 1',
            isLocked: false,
            topTeam: { id: 'team-1', name: 'Team 1', seed: 1 },
            bottomTeam: { id: 'team-2', name: 'Team 2', seed: 16 },
            winnerId: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    };

    renderPage();

    await user.click(screen.getByRole('button', { name: 'make-bracket-pick' }));
    await user.click(screen.getByRole('button', { name: 'reset-bracket' }));
    await user.click(screen.getByRole('button', { name: 'autofill-bracket' }));

    expect(mockMutate).toHaveBeenNthCalledWith(1, {
      entryId: 'entry-1',
      participantId: 'team-1',
      roundNumber: 1,
      matchNumber: 1,
    });
    expect(mockMutate).toHaveBeenNthCalledWith(2);
    expect(mockMutate).toHaveBeenNthCalledWith(3);
  });
});

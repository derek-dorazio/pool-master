import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Component as DraftRoomPage } from './room';
import type { DraftState } from '@/features/draft-room/hooks/use-draft';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ draftId: 'test-draft' }),
    useNavigate: () => mockNavigate,
  };
});

const mockMutate = vi.fn();
let mockDraftReturn: { data: DraftState | undefined; isLoading: boolean; error: Error | null };

vi.mock('@/features/draft-room/hooks/use-draft', () => ({
  useDraft: () => mockDraftReturn,
  useAvailableParticipants: () => ({ data: [], isLoading: false }),
  useMakePick: () => ({ mutate: mockMutate, isPending: false }),
}));

vi.mock('@/features/draft-room/draft-header', () => ({
  DraftHeader: (props: { draft: DraftState }) => (
    <div data-testid="draft-header">{props.draft.contestName}</div>
  ),
}));

vi.mock('@/features/draft-room/available-panel', () => ({
  AvailablePanel: () => <div data-testid="available-panel" />,
}));

vi.mock('@/features/draft-room/pick-board', () => ({
  PickBoard: () => <div data-testid="pick-board" />,
}));

vi.mock('@/features/draft-room/roster-panel', () => ({
  RosterPanel: () => <div data-testid="roster-panel" />,
}));

const mockDraft: DraftState = {
  id: 'test-draft',
  contestId: 'contest-1',
  contestName: 'Masters 2026',
  leagueName: 'Sunday Picks',
  sport: 'GOLF',
  draftType: 'SNAKE',
  mode: 'LIVE' as DraftState['mode'],
  status: 'LIVE' as DraftState['status'],
  currentPickNumber: 3,
  totalPicks: 24,
  currentRound: 1,
  totalRounds: 4,
  currentEntryId: 'entry-1',
  currentEntryName: 'My Team',
  isMyPick: true,
  timePerPickSeconds: 90,
  pickDeadline: new Date(Date.now() + 60000).toISOString(),
  entries: [
    { id: 'entry-1', name: 'My Team', userId: 'me', isCommissioner: false, pickOrder: 1 },
    { id: 'entry-2', name: 'Team Alpha', userId: 'u2', isCommissioner: true, pickOrder: 2 },
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
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/drafts/test-draft']}>
      <Routes>
        <Route path="/drafts/:draftId" element={<DraftRoomPage />} />
        <Route path="/dashboard" element={<div data-testid="dashboard-redirect">Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DraftRoomPage', () => {
  beforeEach(() => {
    mockDraftReturn = { data: mockDraft, isLoading: false, error: null };
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
    expect(screen.getByTestId('pick-board')).toBeInTheDocument();
    expect(screen.getByText('Draft Chat')).toBeInTheDocument();
  });

  it('redirects to dashboard when draft has error', () => {
    mockDraftReturn = { data: undefined, isLoading: false, error: new Error('Not found') };
    renderPage();

    expect(screen.getByTestId('dashboard-redirect')).toBeInTheDocument();
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
});

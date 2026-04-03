import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinLeagueButton, LeaveLeagueButton } from './join-leave-flow';

const {
  mockMutate,
  mockQueryClient,
  mockPost,
  mockDelete,
} = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockQueryClient: { invalidateQueries: vi.fn() },
  mockPost: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
  mockDelete: vi.fn().mockResolvedValue({ data: {}, error: undefined }),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(({ mutationFn }: any) => ({
    mutate: mockMutate.mockImplementation(() => mutationFn()),
    isPending: false,
  })),
  useQueryClient: () => mockQueryClient,
}));

vi.mock('@/lib/api', () => ({
  client: {
    post: mockPost,
    delete: mockDelete,
  },
}));

describe('JoinLeagueButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: {}, error: undefined });
    mockDelete.mockResolvedValue({ data: {}, error: undefined });
  });

  it('shows "Join League" for OPEN policy when membership is none', () => {
    render(<JoinLeagueButton leagueId="lg-1" joinPolicy="OPEN" membershipState="none" />);
    expect(screen.getByRole('button', { name: /Join League/i })).toBeEnabled();
  });

  it('shows disabled "Request Unsupported" for APPROVAL policy until a real backend flow exists', () => {
    render(<JoinLeagueButton leagueId="lg-1" joinPolicy="APPROVAL" membershipState="none" />);
    expect(screen.getByRole('button', { name: /Request Unsupported/i })).toBeDisabled();
  });

  it('shows disabled "Joined" button when already a member', () => {
    render(<JoinLeagueButton leagueId="lg-1" joinPolicy="OPEN" membershipState="member" />);
    expect(screen.getByRole('button', { name: /Joined/i })).toBeDisabled();
  });

  it('shows disabled "Request Pending" button when pending', () => {
    render(<JoinLeagueButton leagueId="lg-1" joinPolicy="APPROVAL" membershipState="pending" />);
    expect(screen.getByRole('button', { name: /Request Pending/i })).toBeDisabled();
  });

  it('calls mutate when join button is clicked', async () => {
    const user = userEvent.setup();
    render(<JoinLeagueButton leagueId="lg-1" joinPolicy="OPEN" membershipState="none" />);
    await user.click(screen.getByRole('button', { name: /Join League/i }));
    expect(mockMutate).toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith({ url: '/api/v1/search/discover/leagues/lg-1/join' });
  });
});

describe('LeaveLeagueButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: {}, error: undefined });
    mockDelete.mockResolvedValue({ data: {}, error: undefined });
  });

  it('shows confirmation dialog when Leave League is clicked', async () => {
    const user = userEvent.setup();
    render(<LeaveLeagueButton leagueId="lg-1" leagueName="Weekend Warriors" />);
    await user.click(screen.getByRole('button', { name: /Leave League/i }));
    expect(screen.getByText(/Are you sure you want to leave/)).toBeInTheDocument();
    expect(screen.getByText('Weekend Warriors')).toBeInTheDocument();
  });

  it('dismisses confirmation when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<LeaveLeagueButton leagueId="lg-1" leagueName="Weekend Warriors" />);
    await user.click(screen.getByRole('button', { name: /Leave League/i }));
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByText(/Are you sure/)).not.toBeInTheDocument();
  });

  it('calls the real leave endpoint when leave is confirmed', async () => {
    const user = userEvent.setup();
    render(<LeaveLeagueButton leagueId="lg-1" leagueName="Weekend Warriors" />);
    await user.click(screen.getByRole('button', { name: /Leave League/i }));
    await user.click(screen.getAllByRole('button', { name: /^Leave League$/i })[1]);
    expect(mockMutate).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ url: '/api/v1/leagues/lg-1/members/me' });
  });
});

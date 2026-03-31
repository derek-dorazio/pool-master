import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockApiPost = vi.fn();

vi.mock('@/lib/api-client', () => ({
  api: { post: (...args: any[]) => mockApiPost(...args) },
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

async function renderCreateLeaguePage() {
  const { Component: CreateLeaguePage } = await import('@/pages/leagues/create');
  return render(
    createElement(MemoryRouter, null, createElement(CreateLeaguePage)),
  );
}

describe('League Create Flow', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes the wizard and calls POST /v1/leagues with correct payload', async () => {
    mockApiPost.mockResolvedValue({ id: 'new-league-123' });

    await renderCreateLeaguePage();

    // Step 1: Fill name
    const nameInput = screen.getByLabelText('League Name');
    await user.type(nameInput, 'Sunday Night Picks');

    // Click Next to go to Step 2
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    await user.click(nextBtn);

    // Step 2: Access settings (defaults are fine — invite-only and private)
    await waitFor(() => {
      expect(screen.getByText('Access & Visibility')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3: Review
    await waitFor(() => {
      expect(screen.getByText('Review & Create')).toBeInTheDocument();
    });

    // Click Create League
    await user.click(screen.getByRole('button', { name: /Create League/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/v1/leagues', {
        name: 'Sunday Night Picks',
        description: '',
        invitePolicy: 'invite-only',
        visibility: 'private',
      });
    });
  });

  it('navigates to the new league page after creation', async () => {
    mockApiPost.mockResolvedValue({ id: 'new-league-123' });

    await renderCreateLeaguePage();

    await user.type(screen.getByLabelText('League Name'), 'My League');
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText('Access & Visibility')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText('Review & Create')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Create League/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/leagues/new-league-123');
    });
  });

  it('shows toast notification on successful league creation', async () => {
    mockApiPost.mockResolvedValue({ id: 'new-league-123' });

    await renderCreateLeaguePage();

    await user.type(screen.getByLabelText('League Name'), 'My League');
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText('Access & Visibility')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText('Review & Create')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Create League/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'League created!' }),
      );
    });
  });

  it('shows error toast when API call fails', async () => {
    mockApiPost.mockRejectedValue(new Error('Network error'));

    await renderCreateLeaguePage();

    await user.type(screen.getByLabelText('League Name'), 'My League');
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText('Access & Visibility')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText('Review & Create')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Create League/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
    });
  });
});

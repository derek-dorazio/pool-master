import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { Component as CreateLeaguePage } from './create';
import { api } from '@/lib/api-client';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/api-client', () => ({
  api: { post: vi.fn() },
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateLeaguePage />
    </MemoryRouter>,
  );
}

describe('CreateLeaguePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders step indicator with 3 steps', () => {
    renderPage();
    expect(screen.getByText('Basics')).toBeInTheDocument();
    expect(screen.getByText('Access')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('step 1 has league name input', () => {
    renderPage();
    expect(screen.getByLabelText('League Name')).toBeInTheDocument();
  });

  it('renders "Next" button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Next/ })).toBeInTheDocument();
  });

  it('has "Back" button disabled on step 1 and enabled on step 2', async () => {
    const user = userEvent.setup();
    renderPage();

    const backBtn = screen.getByRole('button', { name: /Back/ });
    expect(backBtn).toBeDisabled();

    // Fill required name and go to step 2
    await user.type(screen.getByLabelText('League Name'), 'My Test League');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByRole('button', { name: /Back/ })).toBeEnabled();
  });

  // --- Form validation tests ---

  it('empty name shows validation error when clicking Next', async () => {
    const user = userEvent.setup();
    renderPage();

    // Click Next with empty name
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText('Name must be at least 3 characters')).toBeInTheDocument();
    });
    // Should stay on step 1
    expect(screen.getByText('League Basics')).toBeInTheDocument();
  });

  it('name with fewer than 3 characters shows min-length validation error', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('League Name'), 'AB');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText('Name must be at least 3 characters')).toBeInTheDocument();
    });
  });

  it('name exceeding 60 characters shows max-length validation error', async () => {
    const user = userEvent.setup();
    renderPage();

    const longName = 'A'.repeat(61);
    await user.type(screen.getByLabelText('League Name'), longName);

    await waitFor(() => {
      expect(screen.getByText('Name must be 60 characters or less')).toBeInTheDocument();
    });
  });

  it('visibility selection renders public and private options on step 2', async () => {
    const user = userEvent.setup();
    renderPage();

    // Fill name and advance to step 2
    await user.type(screen.getByLabelText('League Name'), 'Test League');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText('Access & Visibility')).toBeInTheDocument();
    });

    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('submitting with valid name and visibility calls the API', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'league-456' });
    renderPage();

    // Step 1: fill name
    await user.type(screen.getByLabelText('League Name'), 'My Pool League');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2: visibility defaults are set, just advance
    await waitFor(() => {
      expect(screen.getByText('Access & Visibility')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // Step 3: Review — click Create League
    await waitFor(() => {
      expect(screen.getByText('Review & Create')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Create League/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/leagues', expect.objectContaining({
        name: 'My Pool League',
        visibility: 'private',
        invitePolicy: 'invite-only',
      }));
    });
    expect(mockNavigate).toHaveBeenCalledWith('/leagues/league-456');
  });
});

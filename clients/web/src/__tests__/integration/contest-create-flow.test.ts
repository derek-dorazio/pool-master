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

async function renderCreateContestPage() {
  const { Component: CreateContestPage } = await import('@/pages/contests/create');
  return render(
    createElement(MemoryRouter, null, createElement(CreateContestPage)),
  );
}

describe('Contest Create Flow', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('progresses through sport and event selection (Step 1)', async () => {
    await renderCreateContestPage();

    // Step 1: Select a sport
    expect(screen.getByText('Select Sport')).toBeInTheDocument();

    // Click Golf sport
    await user.click(screen.getByText('Golf'));

    // Events should appear
    await waitFor(() => {
      expect(screen.getByText('The Masters 2026')).toBeInTheDocument();
    });

    // Select an event
    await user.click(screen.getByText('The Masters 2026'));

    // Click Next
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Should now be on Step 2 (Contest Type)
    await waitFor(() => {
      expect(screen.getByText('Contest Duration')).toBeInTheDocument();
    });
  });

  it('progresses through contest type selection (Step 2)', async () => {
    await renderCreateContestPage();

    // Step 1: Select sport and event
    await user.click(screen.getByText('Golf'));
    await waitFor(() => expect(screen.getByText('The Masters 2026')).toBeInTheDocument());
    await user.click(screen.getByText('The Masters 2026'));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2: Select contest type
    await waitFor(() => {
      expect(screen.getByText('Selection Type')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Snake Draft'));

    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3: Scoring Rules
    await waitFor(() => {
      expect(screen.getByText('Scoring Template')).toBeInTheDocument();
    });
  });

  it('submits the contest creation and calls POST /v1/contests', async () => {
    mockApiPost.mockResolvedValue({ id: 'new-contest-456' });

    await renderCreateContestPage();

    // Step 1: Sport + Event
    await user.click(screen.getByText('Golf'));
    await waitFor(() => expect(screen.getByText('The Masters 2026')).toBeInTheDocument());
    await user.click(screen.getByText('The Masters 2026'));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2: Contest Type
    await waitFor(() => expect(screen.getByText('Selection Type')).toBeInTheDocument());
    await user.click(screen.getByText('Snake Draft'));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3: Scoring Rules
    await waitFor(() => expect(screen.getByText('Scoring Template')).toBeInTheDocument());
    await user.click(screen.getByText('Stroke Play (Standard)'));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4: Draft Config (defaults, just click Next)
    await waitFor(() => expect(screen.getByText('Draft Configuration')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 5: Participants (defaults, just click Next)
    await waitFor(() => expect(screen.getByText('Participant Pool')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 6: Entry Settings (defaults, just click Next)
    await waitFor(() => expect(screen.getByText('Entry Settings')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    // Step 7: Review — click Create Contest
    await waitFor(() => expect(screen.getByText('Review & Create')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Create Contest/i }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/v1/contests',
        expect.objectContaining({
          sport: 'golf',
          eventId: 'masters-2026',
          selectionType: 'snake-draft',
          scoringTemplateId: 'stroke-play',
        }),
      );
    });
  });

  it('navigates to the new contest page after creation', async () => {
    mockApiPost.mockResolvedValue({ id: 'new-contest-456' });

    await renderCreateContestPage();

    // Quick path through wizard
    await user.click(screen.getByText('Golf'));
    await waitFor(() => expect(screen.getByText('The Masters 2026')).toBeInTheDocument());
    await user.click(screen.getByText('The Masters 2026'));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(screen.getByText('Selection Type')).toBeInTheDocument());
    await user.click(screen.getByText('Snake Draft'));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(screen.getByText('Scoring Template')).toBeInTheDocument());
    await user.click(screen.getByText('Stroke Play (Standard)'));
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(screen.getByText('Draft Configuration')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(screen.getByText('Participant Pool')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(screen.getByText('Entry Settings')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(screen.getByText('Review & Create')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Create Contest/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/contests/new-contest-456');
    });
  });
});

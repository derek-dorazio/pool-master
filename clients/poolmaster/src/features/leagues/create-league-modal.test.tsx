import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateLeagueModal } from './create-league-modal';

const createLeagueMock = vi.fn();

vi.mock('@/lib/api', () => ({
  createLeague: (...args: unknown[]) => createLeagueMock(...args),
}));

describe('CreateLeagueModal', () => {
  afterEach(() => {
    createLeagueMock.mockReset();
    document.cookie = 'poolmaster_recent_league=; Path=/; Max-Age=0';
  });

  it('creates a league and routes through the returned league code', async () => {
    createLeagueMock.mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          leagueCode: 'BIGDAWGS',
        },
      },
    });

    const onCreated = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CreateLeagueModal isOpen onClose={vi.fn()} onCreated={onCreated} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs' },
    });
    fireEvent.click(screen.getByLabelText('Private'));
    fireEvent.click(screen.getByTestId('create-league-submit'));

    await waitFor(() =>
      expect(createLeagueMock).toHaveBeenCalledWith({
        body: {
          name: 'Big Dawgs',
          visibility: 'PRIVATE',
        },
      }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('BIGDAWGS'));
  });
});

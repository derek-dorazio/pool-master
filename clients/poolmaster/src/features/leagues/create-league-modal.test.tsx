import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateLeagueModal, suggestLeagueCode } from './create-league-modal';

const { createLeagueMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    createLeagueMock: vi.fn(),
    mockLogger: logger,
  };
});

vi.mock('@/lib/api', () => ({
  createLeague: (...args: unknown[]) => createLeagueMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

describe('CreateLeagueModal', () => {
  afterEach(() => {
    createLeagueMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    document.cookie = 'poolmaster_recent_league=; Path=/; Max-Age=0';
  });

  it('suggests a league code from the league name', () => {
    expect(suggestLeagueCode('Big Dawgs 2026')).toBe('BIGDAWGS2026');
    expect(suggestLeagueCode('A')).toBe('A');
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
    fireEvent.blur(screen.getByTestId('create-league-name'));
    await waitFor(() => expect(screen.getByTestId('create-league-code')).toHaveValue('BIGDAWGS'));
    fireEvent.change(screen.getByTestId('create-league-description'), {
      target: { value: 'Neighborhood commissioner league' },
    });
    fireEvent.click(screen.getByTestId('create-league-next'));
    await waitFor(() => expect(screen.getByTestId('create-league-submit')).toBeVisible());
    fireEvent.click(screen.getByTestId('create-league-submit'));

    await waitFor(() =>
      expect(createLeagueMock).toHaveBeenCalledWith({
        body: {
          name: 'Big Dawgs',
          leagueCode: 'BIGDAWGS',
          description: 'Neighborhood commissioner league',
        },
      }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('BIGDAWGS'));
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'league.create.succeeded',
        data: expect.objectContaining({
          leagueCode: 'BIGDAWGS',
        }),
      }),
      expect.any(String),
    );
  });

  it('stops overwriting league code after the user edits it', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CreateLeagueModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs' },
    });
    fireEvent.blur(screen.getByTestId('create-league-name'));
    await waitFor(() => expect(screen.getByTestId('create-league-code')).toHaveValue('BIGDAWGS'));

    fireEvent.change(screen.getByTestId('create-league-code'), {
      target: { value: 'BIGDOGS26' },
    });
    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs Updated' },
    });
    fireEvent.blur(screen.getByTestId('create-league-name'));

    await waitFor(() => expect(screen.getByTestId('create-league-code')).toHaveValue('BIGDOGS26'));
  });

  it('shows a rejection message when league creation is rejected with a validation payload', async () => {
    createLeagueMock.mockResolvedValue({
      error: {
        message: 'League code is already taken.',
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CreateLeagueModal isOpen onClose={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('create-league-name'), {
      target: { value: 'Big Dawgs' },
    });
    fireEvent.blur(screen.getByTestId('create-league-name'));
    fireEvent.click(screen.getByTestId('create-league-next'));
    await screen.findByTestId('create-league-submit');
    fireEvent.click(screen.getByTestId('create-league-submit'));

    await screen.findByText('League code is already taken.');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'league.create.failed',
      }),
      expect.any(String),
    );
  });
});

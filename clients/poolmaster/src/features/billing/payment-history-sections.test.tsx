import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { LeaguePaymentsSection, MyPaymentsSection } from './payment-history-sections';

const { listLeaguePaymentsMock, listUserPaymentsMock } = vi.hoisted(() => ({
  listLeaguePaymentsMock: vi.fn(),
  listUserPaymentsMock: vi.fn(),
}));

bindApiMocks({
  listLeaguePayments: listLeaguePaymentsMock,
  listUserPayments: listUserPaymentsMock,
});

const SERVER_FAILURE = { error: { error: { code: 'INTERNAL_ERROR', message: 'Payments are down.' } }, status: 500 };

function renderWithClient(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeaguePaymentsSection', () => {
  beforeEach(() => {
    listLeaguePaymentsMock.mockReset();
  });

  it('shows the shared loading line with placeholder rows while the payments load', () => {
    listLeaguePaymentsMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<LeaguePaymentsSection leagueCode="BIGDAWGS" leagueId="league-1" />);

    const loading = screen.getByTestId('league-payments-loading');
    expect(loading).toHaveTextContent('Loading payments...');
    expect(within(loading).getByTestId('loading-placeholder-rows')).toBeInTheDocument();
  });

  it('shows a red error line whose Retry reads the payments again, and then the payments', async () => {
    listLeaguePaymentsMock.mockResolvedValue(SERVER_FAILURE);
    renderWithClient(<LeaguePaymentsSection leagueCode="BIGDAWGS" leagueId="league-1" />);

    const error = await screen.findByTestId('league-payments-error');
    expect(error).toHaveClass('text-destructive');
    listLeaguePaymentsMock.mockResolvedValue({
      data: {
        payments: [{
          id: 'payment-1',
          amountCents: 0,
          contest: null,
          description: 'Masters Pool: up to 50 entries',
          paidAt: '2026-04-01T12:00:00.000Z',
          payer: { id: 'user-1', name: 'Casey Commissioner' },
        }],
      },
    });
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('league-payment-payment-1')).toHaveTextContent('Casey Commissioner');
  });

  it('says there are no payments yet, in the italic empty line, when the league has none', async () => {
    listLeaguePaymentsMock.mockResolvedValue({ data: { payments: [] } });
    renderWithClient(<LeaguePaymentsSection leagueCode="BIGDAWGS" leagueId="league-1" />);

    const empty = await screen.findByTestId('league-payments-empty');
    expect(empty).toHaveTextContent('No payments yet.');
    expect(empty).toHaveClass('italic');
  });
});

describe('MyPaymentsSection', () => {
  beforeEach(() => {
    listUserPaymentsMock.mockReset();
  });

  it('shows a red error line whose Retry reads the viewer\'s payments again', async () => {
    listUserPaymentsMock.mockResolvedValue(SERVER_FAILURE);
    renderWithClient(<MyPaymentsSection />);

    const retry = within(await screen.findByTestId('my-payments-error')).getByRole('button', { name: 'Retry' });
    const callsBefore = listUserPaymentsMock.mock.calls.length;
    fireEvent.click(retry);

    await waitFor(() => expect(listUserPaymentsMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('lists each payment with its league once they load', async () => {
    listUserPaymentsMock.mockResolvedValue({
      data: {
        payments: [{
          id: 'payment-2',
          amountCents: 4900,
          description: 'Pro plan',
          league: { id: 'league-1', leagueCode: 'BIGDAWGS', name: 'Big Dawgs' },
          paidAt: '2026-04-01T12:00:00.000Z',
        }],
      },
    });
    renderWithClient(<MyPaymentsSection />);

    const line = await screen.findByTestId('my-payment-payment-2');
    expect(line).toHaveTextContent('Big Dawgs');
    expect(within(line).getByRole('link', { name: 'Pro plan' })).toHaveAttribute('href', '/league/BIGDAWGS');
  });
});

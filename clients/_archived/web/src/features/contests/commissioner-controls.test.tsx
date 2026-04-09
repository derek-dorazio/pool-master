import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { ContestStatus } from '@poolmaster/shared/domain';
import { server } from '@/test/msw/server';
import { CommissionerContestControls } from './commissioner-controls';

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderComponent(status: string = ContestStatus.ACTIVE) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CommissionerContestControls
        contestId="contest-1"
        contestStatus={status}
        isCommissioner
      />
    </QueryClientProvider>,
  );
}

describe('CommissionerContestControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show an unsupported cancel action', () => {
    renderComponent();
    expect(screen.queryByRole('button', { name: /Cancel Contest/i })).not.toBeInTheDocument();
  });

  it('sends a real score adjustment request', async () => {
    const user = userEvent.setup();
    let receivedBody: unknown;

    server.use(
      http.post('/api/v1/contests/:contestId/scoring/adjust', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );

    renderComponent();

    await user.type(screen.getByPlaceholderText('Entry ID'), 'entry-123');
    await user.type(screen.getByPlaceholderText('Delta'), '4.5');
    await user.type(screen.getByPlaceholderText('Reason for adjustment'), 'Manual correction');
    await user.click(screen.getByRole('button', { name: /Apply Adjustment/i }));

    await waitFor(() => {
      expect(receivedBody).toEqual({
        entryId: 'entry-123',
        adjustment: 4.5,
        reason: 'Manual correction',
      });
    });
  });
});

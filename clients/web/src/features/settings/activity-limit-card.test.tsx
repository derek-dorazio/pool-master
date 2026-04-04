import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityLimitCard } from './activity-limit-card';

const get = vi.fn();
const put = vi.fn();

vi.mock('@/lib/api', () => ({
  client: {
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ActivityLimitCard />
    </QueryClientProvider>,
  );
}

describe('ActivityLimitCard', () => {
  beforeEach(() => {
    get.mockResolvedValue({
      data: {
        activityLimit: {
          enabled: false,
          weeklyContestLimit: 10,
        },
      },
      error: null,
    });
    put.mockImplementation(async ({ body }: { body: { enabled: boolean; weeklyContestLimit: number } }) => ({
      data: { activityLimit: body },
      error: null,
    }));
  });

  it('loads the persisted activity limit settings', async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByDisplayValue('10')).toBeInTheDocument();
    });
  });

  it('saves the real activity limit payload when enabled and updated', async () => {
    const user = userEvent.setup();

    renderCard();

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly contest limit')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('switch', { name: 'Enable activity limits' }));
    fireEvent.change(screen.getByLabelText('Weekly contest limit'), { target: { value: '12' } });

    await waitFor(() => {
      expect(put).toHaveBeenLastCalledWith(expect.objectContaining({
        body: { enabled: true, weeklyContestLimit: 12 },
      }));
    });
  });

  it('lets the user retry after a failed load', async () => {
    const user = userEvent.setup();
    get
      .mockResolvedValueOnce({
        data: null,
        error: new Error('network error'),
      })
      .mockResolvedValueOnce({
        data: {
          activityLimit: {
            enabled: false,
            weeklyContestLimit: 10,
          },
        },
        error: null,
      });

    renderCard();

    expect(await screen.findByText(/couldn't load your activity limit settings/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByDisplayValue('10')).toBeInTheDocument();
    expect(get).toHaveBeenCalled();
  });
});

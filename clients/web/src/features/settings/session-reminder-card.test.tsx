import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionReminderCard } from './session-reminder-card';

const getSessionReminder = vi.fn();
const updateSessionReminder = vi.fn();

vi.mock('@/lib/api', () => ({
  client: {},
  getSessionReminder: (...args: unknown[]) => getSessionReminder(...args),
  updateSessionReminder: (...args: unknown[]) => updateSessionReminder(...args),
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
      <SessionReminderCard />
    </QueryClientProvider>,
  );
}

describe('SessionReminderCard', () => {
  beforeEach(() => {
    getSessionReminder.mockResolvedValue({
      data: {
        sessionReminder: {
          enabled: true,
          intervalMinutes: 60,
        },
      },
      error: null,
    });
    updateSessionReminder.mockImplementation(async ({ body }: { body: { enabled: boolean; intervalMinutes: number } }) => ({
      data: { sessionReminder: body },
      error: null,
    }));
  });

  it('loads persisted reminders and saves interval updates through the backend contract', async () => {
    const user = userEvent.setup();

    renderCard();

    await waitFor(() => {
      expect(screen.getByLabelText('Reminder interval')).toHaveValue('60');
    });

    await user.selectOptions(screen.getByLabelText('Reminder interval'), '90');

    await waitFor(() => {
      expect(updateSessionReminder).toHaveBeenCalledWith(expect.objectContaining({
        body: { enabled: true, intervalMinutes: 90 },
      }));
    });
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { DNDScheduler } from './dnd-scheduler';
import type { NotificationPreferences } from './hooks/use-notification-preferences';

const saveMutation = vi.fn();

const mockPreferences: NotificationPreferences = {
  categories: {
    draft: { inApp: true, push: true, email: false },
    scoring: { inApp: true, push: true, email: true },
    contest: { inApp: true, push: false, email: true },
    league: { inApp: true, push: false, email: false },
    social: { inApp: true, push: false, email: false },
    account: { inApp: true, push: false, email: true },
  },
  dnd: {
    enabled: false,
    startTime: '22:00',
    endTime: '07:00',
    timezone: 'America/New_York',
  },
};

vi.mock('./hooks/use-notification-preferences', () => ({
  useNotificationPreferences: vi.fn(() => ({
    data: mockPreferences,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useSaveNotificationPreferences: vi.fn(() => ({
    mutate: saveMutation,
    isPending: false,
  })),
}));

describe('DNDScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges rapid changes before saving the latest DND settings', () => {
    render(<DNDScheduler />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Off' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveMutation).toHaveBeenCalledTimes(1);
    expect(saveMutation).toHaveBeenCalledWith({
      ...mockPreferences,
      dnd: {
        enabled: true,
        startTime: '20:00',
        endTime: '08:00',
        timezone: 'America/New_York',
      },
    });
  });
});

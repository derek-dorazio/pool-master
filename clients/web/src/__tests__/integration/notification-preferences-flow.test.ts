import { render, screen } from '@testing-library/react';
import { createElement } from 'react';

const mockPreferences = {
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

const mockMutate = vi.fn();

vi.mock('@/features/notifications/hooks/use-notification-preferences', () => ({
  useNotificationPreferences: vi.fn(() => ({
    data: mockPreferences,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useSaveNotificationPreferences: vi.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
}));

vi.mock('@/features/notifications/hooks/use-push-permission', () => ({
  usePushPermission: vi.fn(() => ({
    permission: 'granted',
    isSupported: true,
    isGranted: true,
    isDenied: false,
    isDefault: false,
    requestPermission: vi.fn(),
  })),
}));

// Mock CategoryRow to expose toggles directly in test output
vi.mock('@/features/notifications/category-row', () => ({
  CategoryRow: ({ category }: { category: string }) =>
    createElement('tr', { 'data-testid': `category-row-${category}` },
      createElement('td', null, category),
    ),
  CategoryRowMobile: ({ category }: { category: string }) =>
    createElement('div', { 'data-testid': `category-row-mobile-${category}` }, category),
}));

vi.mock('@/features/notifications/dnd-scheduler', () => ({
  DNDScheduler: () => createElement('div', { 'data-testid': 'dnd-scheduler' }, 'DND Scheduler'),
}));

import { useNotificationPreferences } from '@/features/notifications/hooks/use-notification-preferences';

describe('Notification Preferences Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderPreferencesPage() {
    const { NotificationPreferencesPage } = await import(
      '@/features/notifications/notification-preferences-page'
    );
    return render(createElement(NotificationPreferencesPage));
  }

  it('renders the preferences page heading', async () => {
    await renderPreferencesPage();
    expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
  });

  it('displays all 6 notification categories', async () => {
    await renderPreferencesPage();
    const categories = ['draft', 'scoring', 'contest', 'league', 'social', 'account'];
    for (const cat of categories) {
      expect(screen.getByTestId(`category-row-${cat}`)).toBeInTheDocument();
    }
  });

  it('renders channel headers (In-App, Push, Email) in the preferences matrix', async () => {
    // Import and render the PreferencesMatrix directly
    const { PreferencesMatrix } = await import('@/features/notifications/preferences-matrix');
    render(createElement(PreferencesMatrix));

    expect(screen.getByText('In-App')).toBeInTheDocument();
    expect(screen.getByText('Push')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('renders loading state when preferences are loading', async () => {
    vi.mocked(useNotificationPreferences).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as any);

    const { PreferencesMatrix } = await import('@/features/notifications/preferences-matrix');
    const { container } = render(createElement(PreferencesMatrix));

    // Loading state shows skeleton rows
    const skeletons = container.querySelectorAll('.flex.items-center.gap-4');
    expect(skeletons.length).toBe(6);
  });

  it('renders error state when preferences fail to load', async () => {
    vi.mocked(useNotificationPreferences).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as any);

    const { PreferencesMatrix } = await import('@/features/notifications/preferences-matrix');
    render(createElement(PreferencesMatrix));

    expect(screen.getByText("Couldn't load preferences")).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});

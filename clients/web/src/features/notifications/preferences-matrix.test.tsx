import { render, screen } from '@testing-library/react';
import { PreferencesMatrix } from './preferences-matrix';

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

vi.mock('./hooks/use-notification-preferences', () => ({
  useNotificationPreferences: vi.fn(() => ({
    data: mockPreferences,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useSaveNotificationPreferences: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('./hooks/use-push-permission', () => ({
  usePushPermission: vi.fn(() => ({
    permission: 'granted',
    isSupported: true,
    isGranted: true,
    isDenied: false,
    isDefault: false,
    requestPermission: vi.fn(),
  })),
}));

// Mock child components that aren't under test
vi.mock('./category-row', () => ({
  CategoryRow: ({ category }: { category: string }) => (
    <tr data-testid={`category-row-${category}`}>
      <td>{category}</td>
    </tr>
  ),
  CategoryRowMobile: ({ category }: { category: string }) => (
    <div data-testid={`category-row-mobile-${category}`}>{category}</div>
  ),
}));

import { useNotificationPreferences } from './hooks/use-notification-preferences';

describe('PreferencesMatrix', () => {
  it('renders all 6 category rows', () => {
    render(<PreferencesMatrix />);

    const categories = ['draft', 'scoring', 'contest', 'league', 'social', 'account'];
    for (const cat of categories) {
      expect(screen.getByTestId(`category-row-${cat}`)).toBeInTheDocument();
    }
  });

  it('renders channel headers (In-App, Push, Email)', () => {
    render(<PreferencesMatrix />);

    expect(screen.getByText('In-App')).toBeInTheDocument();
    expect(screen.getByText('Push')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('renders loading state when isLoading', () => {
    vi.mocked(useNotificationPreferences).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as any);

    const { container } = render(<PreferencesMatrix />);

    // Loading state shows skeleton divs (6 rows of skeletons)
    const skeletons = container.querySelectorAll('.flex.items-center.gap-4');
    expect(skeletons.length).toBe(6);
  });

  it('renders error state when preferences fail to load', () => {
    vi.mocked(useNotificationPreferences).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as any);

    render(<PreferencesMatrix />);

    expect(screen.getByText("Couldn't load preferences")).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});

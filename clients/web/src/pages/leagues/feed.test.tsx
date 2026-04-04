import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { Component as LeagueFeedPage } from './feed';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ leagueId: 'league-1' }),
  };
});

vi.mock('@/lib/api', () => ({
  client: {},
  getLeague: vi.fn(),
}));

vi.mock('@/features/social/feed-container', () => ({
  FeedContainer: ({ leagueId, isCommissioner }: { leagueId: string; isCommissioner?: boolean }) => (
    <div
      data-testid="feed-container"
      data-league-id={leagueId}
      data-is-commissioner={String(Boolean(isCommissioner))}
    />
  ),
}));

import { getLeague } from '@/lib/api';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LeagueFeedPage />
    </QueryClientProvider>,
  );
}

describe('LeagueFeedPage', () => {
  beforeEach(() => {
    vi.mocked(getLeague).mockResolvedValue({
      data: {
        league: {
          id: 'league-1',
          name: 'Weekend Warriors',
          role: 'Commissioner',
          visibility: 'PUBLIC',
          memberCount: 12,
          activeContestCount: 1,
        },
      },
      error: null,
    } as any);
  });

  it('derives commissioner access from the league response', async () => {
    renderPage();

    const feed = await screen.findByTestId('feed-container');
    expect(feed).toHaveAttribute('data-league-id', 'league-1');
    expect(feed).toHaveAttribute('data-is-commissioner', 'true');
  });
});

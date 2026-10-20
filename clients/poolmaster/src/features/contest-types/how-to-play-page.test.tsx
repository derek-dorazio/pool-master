import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { HowToPlayPage } from './how-to-play-page';

const { authState, listContestConfigTemplatesMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    authState: { isAuthenticated: false, isLoading: false, isRootAdmin: false, user: null },
    listContestConfigTemplatesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({ listContestConfigTemplates: listContestConfigTemplatesMock });

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => authState }));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function template(templateKey: string, overrides: Record<string, unknown>) {
  return {
    id: `id-${templateKey}`,
    sport: 'GOLF',
    sportLeagueId: null,
    eventType: null,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    templateKey,
    name: `${templateKey} name`,
    description: `${templateKey} description.`,
    sortOrder: 1,
    isDefault: true,
    active: true,
    schemaVersion: 1,
    configuration: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/how-to-play']}>
        <HowToPlayPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listContestConfigTemplatesMock.mockReset();
  authState.isAuthenticated = false;
});

describe('How to Play', () => {
  it('shows a signed-out visitor every sport\'s contest types from the templates, one tile per format, and a way to create an account', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({
      data: {
        templates: [
          template('golf-tiered-pick-6', {}),
          template('golf-tiered-pick-12', { isDefault: false, sortOrder: 2 }),
          template('nfl-squares', { sport: 'AMERICAN_FOOTBALL', sportLeagueId: 'nfl', selectionType: 'SQUARES', contestFormat: 'SQUARES', configuration: { selectionType: 'SQUARES', maxSquaresPerEntry: 10, maxEntriesPerSquad: 1 } }),
        ],
      },
    });
    renderPage();

    const golf = await screen.findByTestId('how-to-play-sport-GOLF');
    expect(within(golf).getByText('Golf')).toBeInTheDocument();
    expect(within(golf).getByTestId('contest-type-golf-tiered-pick-6')).toHaveTextContent('golf-tiered-pick-6 description.');
    expect(within(golf).queryByTestId('contest-type-golf-tiered-pick-12')).not.toBeInTheDocument();
    expect(screen.getByTestId('how-to-play-sport-AMERICAN_FOOTBALL')).toHaveTextContent('nfl-squares name');
    expect(screen.queryByText('Create this contest')).not.toBeInTheDocument();
    expect(listContestConfigTemplatesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { active: 'true' } }));
    for (const register of screen.getAllByTestId('how-to-play-register')) {
      expect(register).toHaveAttribute('href', '/');
    }
  });

  it('sends a signed-in member to their leagues instead of to registration', async () => {
    authState.isAuthenticated = true;
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [template('golf-tiered-pick-6', {})] } });
    renderPage();

    await screen.findByTestId('how-to-play-sport-GOLF');
    expect(screen.getByTestId('how-to-play-leagues')).toHaveAttribute('href', '/welcome');
    expect(screen.queryByTestId('how-to-play-register')).not.toBeInTheDocument();
  });

  it('says the contest types could not be loaded when the template list fails', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText('Contest types unavailable')).toBeInTheDocument();
  });
});

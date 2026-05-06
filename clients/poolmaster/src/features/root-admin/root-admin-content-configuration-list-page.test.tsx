import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootAdminContentConfigurationListPage } from './root-admin-content-configuration-list-page';

const {
  adminListContestConfigTemplatesMock,
  mockLogger,
} = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    adminListContestConfigTemplatesMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListContestConfigTemplates: (...args: unknown[]) =>
    adminListContestConfigTemplatesMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function seedTemplates() {
  adminListContestConfigTemplatesMock.mockResolvedValue({
    data: {
      templates: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          sport: 'GOLF',
          eventType: null,
          contestType: 'ROSTER',
          configMode: 'GOLF_TIERED',
          templateKey: 'golf-tiered-pick-6',
          name: 'Select one from each tier, 4 count',
          description:
            'Pick one golfer from each seeded tier. The best four scores count for the entry total.',
          sortOrder: 1,
          isDefault: true,
          active: true,
          schemaVersion: 1,
          configuration: {
            mode: 'GOLF_TIERED',
            rosterSize: 6,
            countedScores: 4,
            tierSource: 'ODDS',
            tierGeneration: { defaultTierSize: 10 },
            tiers: [
              { tierKey: 'A', label: 'Tier A', pickCount: 1, startPosition: 1, endPosition: 10 },
            ],
            cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
            playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
            displayScoring: 'TO_PAR',
            tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
          },
        },
      ],
    },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminContentConfigurationListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminContentConfigurationListPage', () => {
  afterEach(() => {
    adminListContestConfigTemplatesMock.mockReset();
    mockLogger.info.mockReset();
  });

  it('renders contest templates and links to the dedicated detail page', async () => {
    seedTemplates();

    renderPage();

    expect(
      await screen.findByTestId(
        'root-admin-content-config-link-golf-tiered-pick-6',
      ),
    ).toHaveAttribute(
      'href',
      '/manage/content-configuration/golf-tiered-pick-6',
    );
    expect(
      screen.getByText('Select one from each tier, 4 count'),
    ).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });
});

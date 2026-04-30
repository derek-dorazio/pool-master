import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootAdminContentConfigurationDetailPage } from './root-admin-content-configuration-detail-page';

const {
  adminListContestConfigTemplatesMock,
  adminUpdateContestConfigTemplateMock,
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
    adminUpdateContestConfigTemplateMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListContestConfigTemplates: (...args: unknown[]) =>
    adminListContestConfigTemplatesMock(...args),
  adminUpdateContestConfigTemplate: (...args: unknown[]) =>
    adminUpdateContestConfigTemplateMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function buildTemplate() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sport: 'GOLF',
    eventType: null,
    contestType: 'SINGLE_EVENT',
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
        { tierKey: 'B', label: 'Tier B', pickCount: 1, startPosition: 11, endPosition: 20 },
      ],
      cutRule: { type: 'FIXED_SCORE', fixedScore: 80 },
      playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
      displayScoring: 'TO_PAR',
      tiebreaker: { type: 'PREDICT_WINNING_SCORE' },
    },
  };
}

function seedTemplates() {
  adminListContestConfigTemplatesMock.mockResolvedValue({
    data: {
      templates: [buildTemplate()],
    },
  });
  adminUpdateContestConfigTemplateMock.mockResolvedValue({
    data: {
      template: buildTemplate(),
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
      <MemoryRouter initialEntries={['/manage/content-configuration/golf-tiered-pick-6']}>
        <Routes>
          <Route
            element={<RootAdminContentConfigurationDetailPage />}
            path="/manage/content-configuration/:templateKey"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminContentConfigurationDetailPage', () => {
  afterEach(() => {
    adminListContestConfigTemplatesMock.mockReset();
    adminUpdateContestConfigTemplateMock.mockReset();
    mockLogger.info.mockReset();
  });

  // pool-master-dxd.43 — tier template edits derive roster size from tier count and picks per tier.
  it('loads a template and submits generic tier updates from the dedicated page', async () => {
    seedTemplates();

    renderPage();

    expect(
      await screen.findByDisplayValue('Select one from each tier, 4 count'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('root-admin-content-config-name'), {
      target: { value: 'Updated template name' },
    });
    fireEvent.change(screen.getByTestId('root-admin-content-config-tier-count'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByTestId('root-admin-content-config-picks-per-tier'), {
      target: { value: '2' },
    });

    fireEvent.click(screen.getByTestId('root-admin-content-config-save'));

    await waitFor(() => {
      expect(adminUpdateContestConfigTemplateMock).toHaveBeenCalledWith({
        path: {
          templateId: '11111111-1111-4111-8111-111111111111',
        },
        body: expect.objectContaining({
          name: 'Updated template name',
          configuration: expect.objectContaining({
            rosterSize: 6,
            tiers: expect.arrayContaining([
              expect.objectContaining({ tierKey: 'A', pickCount: 2, endPosition: 10 }),
              expect.objectContaining({ tierKey: 'B', pickCount: 2, endPosition: 20 }),
              expect.objectContaining({ tierKey: 'C', pickCount: 2, endPosition: 30 }),
            ]),
          }),
        }),
      });
    });
  });
});

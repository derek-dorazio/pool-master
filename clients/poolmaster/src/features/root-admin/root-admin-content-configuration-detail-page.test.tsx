import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
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

bindApiMocks({
  adminListContestConfigTemplates: adminListContestConfigTemplatesMock,
  adminUpdateContestConfigTemplate: adminUpdateContestConfigTemplateMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function buildTemplate() {
  return {
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

  // pool-master-piv — tier structure/price are event-owned now; the template only edits
  // rosterSize/countedScores.
  it('loads a template and submits roster size / counted scores updates from the dedicated page', async () => {
    seedTemplates();

    renderPage();

    expect(
      await screen.findByDisplayValue('Select one from each tier, 4 count'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('root-admin-content-config-name'), {
      target: { value: 'Updated template name' },
    });
    fireEvent.change(screen.getByTestId('root-admin-content-config-roster-size'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByTestId('root-admin-content-config-counted-scores'), {
      target: { value: '8' },
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
            rosterSize: 12,
            countedScores: 8,
          }),
        }),
      });
    });
  });
});

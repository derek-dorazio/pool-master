import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfFieldGridCard } from './golf-field-grid-card';
import type { GolfFieldEntry } from './golf-field-patch';
import { fieldEntryFixture, valuationFixture } from './golf-test-fixtures';

// plans/124 §6.3 / §8 — Field editor grid: form-state-hazard + null-value rendering.

const { updateEventParticipantsMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return { updateEventParticipantsMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({ updateEventParticipants: updateEventParticipantsMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function entry(overrides: Partial<GolfFieldEntry> = {}): GolfFieldEntry {
  return fieldEntryFixture({
    id: 'sep-1',
    participantId: 'p-1',
    ranking: 2,
    oddsToWin: 8.5,
    seedNumber: 2,
    valuation: valuationFixture({ price: 9500 }),
    ...overrides,
  });
}

function renderCard(props: Partial<Parameters<typeof GolfFieldGridCard>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GolfFieldGridCard
          entries={[entry()]}
          eventId="evt-1"
          fieldError={null}
          fieldLoading={false}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-za4 GolfFieldGridCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-za4 renders an empty (not "null") input for a golfer with no derived price', () => {
    renderCard({ entries: [entry({ valuation: null })] });
    const priceInput = screen.getByTestId('root-admin-golf-field-price-sep-1');
    expect(priceInput).toHaveValue('');
    expect(priceInput).not.toHaveAttribute('aria-invalid');
  });

  it('pool-master-za4 preserves an in-progress draft when the same eventId refetches', async () => {
    const { rerender } = renderCard();
    await userEvent.clear(screen.getByTestId('root-admin-golf-field-ranking-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-golf-field-ranking-sep-1'), '1');
    expect(screen.getByTestId('root-admin-golf-field-dirty-bar')).toHaveTextContent('1 unsaved');

    // Same eventId, new entries array (a background refetch of the field query).
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GolfFieldGridCard
            entries={[entry({ ranking: 3 })]}
            eventId="evt-1"
            fieldError={null}
            fieldLoading={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('root-admin-golf-field-ranking-sep-1')).toHaveValue('1');
    expect(screen.getByTestId('root-admin-golf-field-dirty-bar')).toBeInTheDocument();
  });

  it('pool-master-za4 clears the draft when the eventId changes', async () => {
    const { rerender } = renderCard();
    await userEvent.clear(screen.getByTestId('root-admin-golf-field-ranking-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-golf-field-ranking-sep-1'), '1');
    expect(screen.getByTestId('root-admin-golf-field-dirty-bar')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GolfFieldGridCard
            entries={[entry()]}
            eventId="evt-2"
            fieldError={null}
            fieldLoading={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('root-admin-golf-field-ranking-sep-1')).toHaveValue('2');
    expect(screen.queryByTestId('root-admin-golf-field-dirty-bar')).not.toBeInTheDocument();
  });
});

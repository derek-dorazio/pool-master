import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventFieldGridCard } from './event-field-grid-card';
import type { EventFieldEntry } from './event-field-patch';
import { fieldEntryFixture, valuationFixture } from './sport-test-fixtures';

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

function entry(overrides: Partial<EventFieldEntry> = {}): EventFieldEntry {
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

function renderCard(props: Partial<Parameters<typeof EventFieldGridCard>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EventFieldGridCard
          entries={[entry()]}
          eventId="evt-1"
          fieldError={null}
          fieldLoading={false}
          sport="GOLF"
          sportLeagueNoun={{ one: 'tour', many: 'tours' }}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-za4 EventFieldGridCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('titles the card with the field size and points to the Tiers page on its first line', () => {
    renderCard({ entries: [entry(), entry({ id: 'sep-2', participantId: 'p-2' })] });

    const card = screen.getByRole('region', { name: 'Field (2)' });
    expect(card).toContainElement(screen.getByTestId('root-admin-event-field-tiers-link'));
  });

  it('pool-master-za4 renders an empty (not "null") input for a golfer with no derived price', () => {
    renderCard({ entries: [entry({ valuation: null })] });
    const priceInput = screen.getByTestId('root-admin-event-field-price-sep-1');
    expect(priceInput).toHaveValue('');
    expect(priceInput).not.toHaveAttribute('aria-invalid');
  });

  it('pool-master-za4 preserves an in-progress draft when the same eventId refetches', async () => {
    const { rerender } = renderCard();
    await userEvent.clear(screen.getByTestId('root-admin-event-field-ranking-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-event-field-ranking-sep-1'), '1');
    expect(screen.getByTestId('root-admin-event-field-dirty-bar')).toHaveTextContent('1 unsaved');

    // Same eventId, new entries array (a background refetch of the field query).
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <EventFieldGridCard
            entries={[entry({ ranking: 3 })]}
            eventId="evt-1"
            sport="GOLF"
            sportLeagueNoun={{ one: 'tour', many: 'tours' }}
            fieldError={null}
            fieldLoading={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('root-admin-event-field-ranking-sep-1')).toHaveValue('1');
    expect(screen.getByTestId('root-admin-event-field-dirty-bar')).toBeInTheDocument();
  });

  it('pool-master-za4 clears the draft when the eventId changes', async () => {
    const { rerender } = renderCard();
    await userEvent.clear(screen.getByTestId('root-admin-event-field-ranking-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-event-field-ranking-sep-1'), '1');
    expect(screen.getByTestId('root-admin-event-field-dirty-bar')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <EventFieldGridCard
            entries={[entry()]}
            eventId="evt-2"
            sport="GOLF"
            sportLeagueNoun={{ one: 'tour', many: 'tours' }}
            fieldError={null}
            fieldLoading={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('root-admin-event-field-ranking-sep-1')).toHaveValue('2');
    expect(screen.queryByTestId('root-admin-event-field-dirty-bar')).not.toBeInTheDocument();
  });
});

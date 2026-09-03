import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfFieldGridCard } from './golf-field-grid-card';
import type { GolfFieldEntry } from './golf-field-patch';

// plans/124 §6.3 / §8 — Field editor grid: form-state-hazard + null-value rendering.

const { adminUpdateGolfFieldEntriesMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return { adminUpdateGolfFieldEntriesMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({ adminUpdateGolfFieldEntries: adminUpdateGolfFieldEntriesMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function entry(overrides: Partial<GolfFieldEntry> = {}): GolfFieldEntry {
  return {
    sportEventParticipantId: 'sep-1',
    participantId: 'p-1',
    participantName: 'Rory McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    isActive: true,
    inactiveReason: null as unknown as GolfFieldEntry['inactiveReason'],
    worldRanking: 2,
    oddsToWin: 8.5,
    seedNumber: 2,
    price: 9500,
    isLeagueRosterMember: true,
    ...overrides,
  };
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
          readOnly={false}
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
    renderCard({ entries: [entry({ price: null as unknown as number })] });
    const priceInput = screen.getByTestId('root-admin-golf-field-price-sep-1');
    expect(priceInput).toHaveValue('');
    expect(priceInput).not.toHaveAttribute('aria-invalid');
  });

  it('pool-master-za4 preserves an in-progress draft when the same eventId refetches', async () => {
    const { rerender } = renderCard();
    await userEvent.clear(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1'), '1');
    expect(screen.getByTestId('root-admin-golf-field-dirty-bar')).toHaveTextContent('1 unsaved');

    // Same eventId, new entries array (a background refetch of the field query).
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GolfFieldGridCard
            entries={[entry({ worldRanking: 3 })]}
            eventId="evt-1"
            fieldError={null}
            fieldLoading={false}
            readOnly={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1')).toHaveValue('1');
    expect(screen.getByTestId('root-admin-golf-field-dirty-bar')).toBeInTheDocument();
  });

  it('pool-master-za4 clears the draft when the eventId changes', async () => {
    const { rerender } = renderCard();
    await userEvent.clear(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1'), '1');
    expect(screen.getByTestId('root-admin-golf-field-dirty-bar')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GolfFieldGridCard
            entries={[entry()]}
            eventId="evt-2"
            fieldError={null}
            fieldLoading={false}
            readOnly={false}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1')).toHaveValue('2');
    expect(screen.queryByTestId('root-admin-golf-field-dirty-bar')).not.toBeInTheDocument();
  });

  it('pool-master-za4 hides the save bar when readOnly', async () => {
    renderCard({ readOnly: true });
    await userEvent.clear(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-golf-field-worldRanking-sep-1'), '1');
    expect(screen.queryByTestId('root-admin-golf-field-dirty-bar')).not.toBeInTheDocument();
  });
});
